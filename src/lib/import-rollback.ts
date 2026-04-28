import { prisma } from "@/src/lib/prisma";
import { syncHoldingPnlSnapshots } from "@/src/lib/pnl-snapshots";
import { syncHoldingFromEvents } from "@/src/lib/holding-rules";

type RollbackDeletedCounts = {
  positions: number;
  positionActions: number;
  positionLegs: number;
  holdings: number;
  holdingEvents: number;
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

function hasImportPrefix(value: string | null | undefined, importPrefix: string) {
  return value?.includes(importPrefix) ?? false;
}

function isImportedReference(value: string | null | undefined, importPrefix: string) {
  return value?.startsWith(importPrefix) ?? false;
}

type HoldingRollbackTarget = {
  id: string;
  symbol: string;
  deleteHolding: boolean;
};

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
        holdingId: true,
        linkedPositionActionId: true,
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

  const importedActionIds = importedPositionActions.map((action) => action.id);
  const importedActionIdSet = new Set(importedActionIds);
  const importedPositionIds = [...new Set(importedPositionActions.map((action) => action.positionId))];
  const importedPositionIdSet = new Set(importedPositionIds);
  const rawTransactionIds = importedRawTransactions.map((row) => row.id);
  const importedHoldingEventIds = holdingEventsFromBatch.map((event) => event.id);
  const importedHoldingEventIdSet = new Set(importedHoldingEventIds);
  const importedHoldingIds = [...new Set(holdingEventsFromBatch.map((event) => event.holdingId))];

  const [positions, touchedHoldings] = await Promise.all([
    importedPositionIds.length === 0
      ? Promise.resolve([])
      : prisma.position.findMany({
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
      }),
    importedHoldingIds.length === 0
      ? Promise.resolve([])
      : prisma.holding.findMany({
        where: {
          id: {
            in: importedHoldingIds,
          },
          brokerAccount: {
            userId,
          },
        },
        include: {
          holdingEvents: {
            select: {
              id: true,
              eventTimestamp: true,
              createdAt: true,
              notes: true,
              linkedPositionActionId: true,
            },
            orderBy: [{ eventTimestamp: "asc" }, { createdAt: "asc" }],
          },
          linkedFromPositions: {
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
      }),
  ]);

  const rollbackBlockers: string[] = [];

  for (const position of positions) {
    const nonBatchActions = position.actions.filter((action) => !isImportedReference(action.brokerReference, importPrefix));
    if (nonBatchActions.length > 0) {
      rollbackBlockers.push(`Position ${position.underlyingSymbol} has actions that were not created by this import batch.`);
    }

    if (position.notes.length > 0 || position.attachments.length > 0 || position.tagLinks.length > 0 || position.journalEntry) {
      rollbackBlockers.push(`Position ${position.underlyingSymbol} has journal or note data attached.`);
    }

    if (position.sourceHoldings.length > 0) {
      rollbackBlockers.push(`Position ${position.underlyingSymbol} is linked to holding records.`);
    }

    const nonBatchCashEntries = position.cashLedgerEntries.filter((entry) => !isImportedReference(entry.externalReference, importPrefix));
    if (nonBatchCashEntries.length > 0) {
      rollbackBlockers.push(`Position ${position.underlyingSymbol} has cash ledger entries not created by this import batch.`);
    }
  }

  const holdingTargets: HoldingRollbackTarget[] = [];

  for (const holding of touchedHoldings) {
    const batchEvents = holding.holdingEvents.filter((event) =>
      importedHoldingEventIdSet.has(event.id) ||
      importedActionIdSet.has(event.linkedPositionActionId ?? "") ||
      hasImportPrefix(event.notes, importPrefix),
    );
    const nonBatchEvents = holding.holdingEvents.filter((event) => !batchEvents.some((batchEvent) => batchEvent.id === event.id));

    if (batchEvents.length === 0) {
      continue;
    }

    let sawBatchEvent = false;
    for (const event of holding.holdingEvents) {
      const isBatchEvent = batchEvents.some((batchEvent) => batchEvent.id === event.id);
      if (isBatchEvent) {
        sawBatchEvent = true;
        continue;
      }

      if (sawBatchEvent) {
        rollbackBlockers.push(`Holding ${holding.symbol} has newer events after this import batch, so it cannot be undone automatically.`);
        break;
      }
    }

    const dependentPositions = holding.linkedFromPositions.filter((position) => !importedPositionIdSet.has(position.id));
    if (dependentPositions.length > 0) {
      rollbackBlockers.push(`Holding ${holding.symbol} is linked to positions not created by this import batch.`);
    }

    const nonBatchCashEntries = holding.cashLedgerEntries.filter((entry) => !isImportedReference(entry.externalReference, importPrefix));
    if (nonBatchCashEntries.length > 0) {
      rollbackBlockers.push(`Holding ${holding.symbol} has cash ledger entries not created by this import batch.`);
    }

    const holdingCreatedByBatch = hasImportPrefix(holding.notes, importPrefix);

    if (holdingCreatedByBatch) {
      if (nonBatchEvents.length > 0) {
        rollbackBlockers.push(`Holding ${holding.symbol} has non-import events and cannot be deleted safely.`);
        continue;
      }

      holdingTargets.push({
        id: holding.id,
        symbol: holding.symbol,
        deleteHolding: true,
      });
      continue;
    }

    if (nonBatchEvents.length === 0) {
      rollbackBlockers.push(`Holding ${holding.symbol} has no pre-import history, so this batch cannot be undone automatically.`);
      continue;
    }

    holdingTargets.push({
      id: holding.id,
      symbol: holding.symbol,
      deleteHolding: false,
    });
  }

  if (rollbackBlockers.length > 0) {
    throw new Error(rollbackBlockers[0] ?? "This import batch cannot be undone automatically because newer records depend on it.");
  }

  const uniquePositionIds = positions.map((position) => position.id);
  const holdingIdsToDelete = holdingTargets.filter((target) => target.deleteHolding).map((target) => target.id);
  const holdingIdsToRecompute = holdingTargets.filter((target) => !target.deleteHolding).map((target) => target.id);

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

    const deletedHoldingEvents = importedHoldingEventIds.length === 0
      ? { count: 0 }
      : await tx.holdingEvent.deleteMany({
        where: {
          id: {
            in: importedHoldingEventIds,
          },
        },
      });

    const deletedHoldings = holdingIdsToDelete.length === 0
      ? { count: 0 }
      : await tx.holding.deleteMany({
        where: {
          id: {
            in: holdingIdsToDelete,
          },
        },
      });

    for (const holdingId of holdingIdsToRecompute) {
      await syncHoldingFromEvents(holdingId, tx);
    }

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
      holdings: deletedHoldings.count,
      holdingEvents: deletedHoldingEvents.count,
      cashLedgerEntries: deletedCashLedger.count,
      rawTransactions: deletedRawTransactions.count,
      orders: deletedOrders.count,
      executions: deletedExecutions.count,
      _actionLegChanges: deletedActionLegChanges.count,
    };
  });

  if (holdingIdsToRecompute.length > 0) {
    await syncHoldingPnlSnapshots(holdingIdsToRecompute);
  }

  return {
    importBatchId,
    deleted: {
      positions: deleted.positions,
      positionActions: deleted.positionActions,
      positionLegs: deleted.positionLegs,
      holdings: deleted.holdings,
      holdingEvents: deleted.holdingEvents,
      cashLedgerEntries: deleted.cashLedgerEntries,
      rawTransactions: deleted.rawTransactions,
      orders: deleted.orders,
      executions: deleted.executions,
    },
  };
}
