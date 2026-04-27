import { prisma } from "@/src/lib/prisma";

type RollbackDeletedCounts = {
  positions: number;
  positionActions: number;
  positionLegs: number;
  cashLedgerEntries: number;
  rawTransactions: number;
  orders: number;
  executions: number;
};

export type RollbackImportBatchResult = {
  importBatchId: string;
  deleted: RollbackDeletedCounts;
};

function getImportPrefix(importBatchId: string) {
  return `IMPORT:${importBatchId}:`;
}

export async function rollbackImportBatchForUser(userId: string, importBatchId: string): Promise<RollbackImportBatchResult> {
  const batch = await prisma.importBatch.findFirst({
    where: {
      id: importBatchId,
      brokerAccount: {
        userId,
      },
    },
    include: {
      brokerAccount: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!batch) {
    throw new Error("Import batch not found.");
  }

  const importPrefix = getImportPrefix(importBatchId);

  const [holdingEventsFromBatch, importedPositionActions, importedRawTransactions] = await Promise.all([
    prisma.holdingEvent.findMany({
      where: {
        holding: {
          brokerAccount: {
            userId,
          },
        },
        OR: [
          {
            notes: {
              contains: importPrefix,
            },
          },
          {
            positionAction: {
              brokerReference: {
                startsWith: importPrefix,
              },
            },
          },
        ],
      },
      select: {
        id: true,
      },
    }),
    prisma.positionAction.findMany({
      where: {
        brokerReference: {
          startsWith: importPrefix,
        },
        position: {
          brokerAccount: {
            userId,
          },
        },
      },
      select: {
        id: true,
        positionId: true,
      },
    }),
    prisma.rawTransaction.findMany({
      where: {
        importBatchId,
        brokerAccount: {
          userId,
        },
      },
      select: {
        id: true,
      },
    }),
  ]);

  if (holdingEventsFromBatch.length > 0) {
    throw new Error("Rollback is currently blocked for batches that imported holdings. Position-only batches are supported first.");
  }

  const importedActionIds = importedPositionActions.map((action) => action.id);
  const importedPositionIds = [...new Set(importedPositionActions.map((action) => action.positionId))];
  const rawTransactionIds = importedRawTransactions.map((row) => row.id);

  const positions = importedPositionIds.length === 0
    ? []
    : await prisma.position.findMany({
      where: {
        id: {
          in: importedPositionIds,
        },
        brokerAccount: {
          userId,
        },
      },
      include: {
        actions: {
          select: {
            id: true,
            brokerReference: true,
          },
        },
        notes: {
          select: {
            id: true,
          },
        },
        attachments: {
          select: {
            id: true,
          },
        },
        tagLinks: {
          select: {
            id: true,
          },
        },
        journalEntry: {
          select: {
            id: true,
          },
        },
        sourceHoldings: {
          select: {
            id: true,
          },
        },
        cashLedgerEntries: {
          select: {
            id: true,
            externalReference: true,
          },
        },
      },
    });

  const rollbackBlockers: string[] = [];

  for (const position of positions) {
    const nonBatchActions = position.actions.filter((action) => !action.brokerReference?.startsWith(importPrefix));
    if (nonBatchActions.length > 0) {
      rollbackBlockers.push(`Position ${position.underlyingSymbol} has actions that were not created by this import batch.`);
    }

    if (position.notes.length > 0 || position.attachments.length > 0 || position.tagLinks.length > 0 || position.journalEntry) {
      rollbackBlockers.push(`Position ${position.underlyingSymbol} has journal or note data attached.`);
    }

    if (position.sourceHoldings.length > 0) {
      rollbackBlockers.push(`Position ${position.underlyingSymbol} is linked to holding records.`);
    }

    const nonBatchCashEntries = position.cashLedgerEntries.filter((entry) => !entry.externalReference?.startsWith(importPrefix));
    if (nonBatchCashEntries.length > 0) {
      rollbackBlockers.push(`Position ${position.underlyingSymbol} has cash ledger entries not created by this import batch.`);
    }
  }

  if (rollbackBlockers.length > 0) {
    throw new Error(rollbackBlockers[0] ?? "This import batch cannot be undone automatically because newer records depend on it.");
  }

  const uniquePositionIds = positions.map((position) => position.id);

  const deleted = await prisma.$transaction(async (tx) => {
    const deletedCashLedger = await tx.cashLedger.deleteMany({
      where: {
        brokerAccountId: batch.brokerAccount?.id ?? undefined,
        OR: [
          {
            externalReference: {
              startsWith: importPrefix,
            },
          },
          uniquePositionIds.length > 0
            ? {
              linkedPositionId: {
                in: uniquePositionIds,
              },
            }
            : undefined,
        ].filter(Boolean) as Array<Record<string, unknown>>,
      },
    });

    const deletedActionLegChanges = importedActionIds.length === 0
      ? { count: 0 }
      : await tx.actionLegChange.deleteMany({
        where: {
          positionActionId: {
            in: importedActionIds,
          },
        },
      });

    const deletedPositionActions = importedActionIds.length === 0
      ? { count: 0 }
      : await tx.positionAction.deleteMany({
        where: {
          id: {
            in: importedActionIds,
          },
        },
      });

    const deletedPositionLegs = uniquePositionIds.length === 0
      ? { count: 0 }
      : await tx.positionLeg.deleteMany({
        where: {
          positionId: {
            in: uniquePositionIds,
          },
        },
      });

    const deletedPositions = uniquePositionIds.length === 0
      ? { count: 0 }
      : await tx.position.deleteMany({
        where: {
          id: {
            in: uniquePositionIds,
          },
        },
      });

    const deletedExecutions = await tx.execution.deleteMany({
      where: {
        importBatchId,
      },
    });

    const deletedOrders = await tx.order.deleteMany({
      where: {
        importBatchId,
      },
    });

    const deletedRawTransactions = rawTransactionIds.length === 0
      ? { count: 0 }
      : await tx.rawTransaction.deleteMany({
        where: {
          id: {
            in: rawTransactionIds,
          },
        },
      });

    await tx.importBatch.delete({
      where: {
        id: importBatchId,
      },
    });

    return {
      positions: deletedPositions.count,
      positionActions: deletedPositionActions.count,
      positionLegs: deletedPositionLegs.count,
      cashLedgerEntries: deletedCashLedger.count,
      rawTransactions: deletedRawTransactions.count,
      orders: deletedOrders.count,
      executions: deletedExecutions.count,
      _actionLegChanges: deletedActionLegChanges.count,
    };
  });

  return {
    importBatchId,
    deleted: {
      positions: deleted.positions,
      positionActions: deleted.positionActions,
      positionLegs: deleted.positionLegs,
      cashLedgerEntries: deleted.cashLedgerEntries,
      rawTransactions: deleted.rawTransactions,
      orders: deleted.orders,
      executions: deleted.executions,
    },
  };
}
