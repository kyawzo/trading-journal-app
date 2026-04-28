import { prisma } from "./prisma";
import { calculateHoldingPnlSummary, calculatePositionPnlSummary } from "./pnl";

function toDecimalString(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : "0";
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export async function syncPositionPnlSnapshot(positionId: string) {
  const position = await prisma.position.findUnique({
    where: { id: positionId },
    select: {
      id: true,
      brokerAccountId: true,
      actions: {
        select: {
          actionType: true,
          amount: true,
          feeAmount: true,
          currency: true,
          quantity: true,
          premiumPerUnit: true,
        },
        orderBy: [{ actionTimestamp: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!position) {
    return;
  }

  const summary = calculatePositionPnlSummary(position.actions);

  await prisma.positionPnlSnapshot.upsert({
    where: { positionId },
    create: {
      positionId,
      brokerAccountId: position.brokerAccountId,
      currency: summary.currency,
      grossCredits: toDecimalString(summary.grossCredits),
      grossDebits: toDecimalString(summary.grossDebits),
      totalFees: toDecimalString(summary.totalFees),
      netCashFlow: toDecimalString(summary.netCashFlow),
      ignoredAmountCount: summary.ignoredAmountCount,
      refreshedAt: new Date(),
    },
    update: {
      brokerAccountId: position.brokerAccountId,
      currency: summary.currency,
      grossCredits: toDecimalString(summary.grossCredits),
      grossDebits: toDecimalString(summary.grossDebits),
      totalFees: toDecimalString(summary.totalFees),
      netCashFlow: toDecimalString(summary.netCashFlow),
      ignoredAmountCount: summary.ignoredAmountCount,
      refreshedAt: new Date(),
    },
  });
}

export async function syncHoldingPnlSnapshot(holdingId: string) {
  const holding = await prisma.holding.findUnique({
    where: { id: holdingId },
    select: {
      id: true,
      brokerAccountId: true,
      costBasisPerShare: true,
      remainingQuantity: true,
      holdingEvents: {
        select: {
          eventType: true,
          quantity: true,
          pricePerShare: true,
          amount: true,
          feeAmount: true,
          currency: true,
        },
        orderBy: [{ eventTimestamp: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!holding) {
    return;
  }

  const summary = calculateHoldingPnlSummary(holding);

  await prisma.holdingPnlSnapshot.upsert({
    where: { holdingId },
    create: {
      holdingId,
      brokerAccountId: holding.brokerAccountId,
      currency: summary.currency,
      acquiredShares: toDecimalString(summary.acquiredShares),
      soldShares: toDecimalString(summary.soldShares),
      grossPurchaseCost: toDecimalString(summary.grossPurchaseCost),
      grossSaleProceeds: toDecimalString(summary.grossSaleProceeds),
      acquisitionFees: toDecimalString(summary.acquisitionFees),
      dispositionFees: toDecimalString(summary.dispositionFees),
      totalFees: toDecimalString(summary.totalFees),
      effectiveCostBasisPerShare: toDecimalString(summary.effectiveCostBasisPerShare),
      estimatedCostOfSoldShares: toDecimalString(summary.estimatedCostOfSoldShares),
      estimatedRealizedPnl: toDecimalString(summary.estimatedRealizedPnl),
      estimatedOpenCost: toDecimalString(summary.estimatedOpenCost),
      refreshedAt: new Date(),
    },
    update: {
      brokerAccountId: holding.brokerAccountId,
      currency: summary.currency,
      acquiredShares: toDecimalString(summary.acquiredShares),
      soldShares: toDecimalString(summary.soldShares),
      grossPurchaseCost: toDecimalString(summary.grossPurchaseCost),
      grossSaleProceeds: toDecimalString(summary.grossSaleProceeds),
      acquisitionFees: toDecimalString(summary.acquisitionFees),
      dispositionFees: toDecimalString(summary.dispositionFees),
      totalFees: toDecimalString(summary.totalFees),
      effectiveCostBasisPerShare: toDecimalString(summary.effectiveCostBasisPerShare),
      estimatedCostOfSoldShares: toDecimalString(summary.estimatedCostOfSoldShares),
      estimatedRealizedPnl: toDecimalString(summary.estimatedRealizedPnl),
      estimatedOpenCost: toDecimalString(summary.estimatedOpenCost),
      refreshedAt: new Date(),
    },
  });
}

export async function syncPositionPnlSnapshots(positionIds: string[]) {
  for (const positionId of uniqueIds(positionIds)) {
    await syncPositionPnlSnapshot(positionId);
  }
}

export async function syncHoldingPnlSnapshots(holdingIds: string[]) {
  for (const holdingId of uniqueIds(holdingIds)) {
    await syncHoldingPnlSnapshot(holdingId);
  }
}

export async function syncPnlSnapshotsForImportBatch(importBatchId: string) {
  const importPrefix = `IMPORT:${importBatchId}:`;

  const [positionActions, holdingEvents] = await Promise.all([
    prisma.positionAction.findMany({
      where: {
        brokerReference: {
          startsWith: importPrefix,
        },
      },
      select: {
        positionId: true,
      },
    }),
    prisma.holdingEvent.findMany({
      where: {
        notes: {
          contains: importPrefix,
          mode: "insensitive",
        },
      },
      select: {
        holdingId: true,
      },
    }),
  ]);

  await syncPositionPnlSnapshots(positionActions.map((action) => action.positionId));
  await syncHoldingPnlSnapshots(holdingEvents.map((event) => event.holdingId));
}

export async function syncAllExistingPnlSnapshots() {
  const [positions, holdings] = await Promise.all([
    prisma.position.findMany({
      select: { id: true },
    }),
    prisma.holding.findMany({
      select: { id: true },
    }),
  ]);

  await syncPositionPnlSnapshots(positions.map((position) => position.id));
  await syncHoldingPnlSnapshots(holdings.map((holding) => holding.id));
}
