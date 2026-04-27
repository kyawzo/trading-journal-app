import { prisma } from "./prisma";

type NumericLike = number | string | bigint | { toString(): string } | null | undefined;

type CoveredCallLeg = {
  id?: string;
  legType: string;
  legSide: string;
  optionType?: string | null;
  legStatus?: string | null;
  quantity: NumericLike;
  multiplier: NumericLike;
};

const INACTIVE_CALL_STATUSES = new Set(["CLOSED", "EXPIRED", "EXERCISED", "ROLLED", "REPLACED", "ASSIGNED"]);
const ACTIVE_LEG_STATUSES = new Set(["OPEN", "PARTIALLY_CLOSED"]);

export function isActiveLegStatus(status: string | null | undefined) {
  return ACTIVE_LEG_STATUSES.has(status ?? "");
}

export function parseNumericInput(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toNumber(value: NumericLike) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateCoveredCallShareUsage(
  legs: CoveredCallLeg[],
  options?: { excludeLegId?: string; excludeLegIds?: string[] }
) {
  const excludedIds = new Set(
    options?.excludeLegIds ?? (options?.excludeLegId ? [options.excludeLegId] : [])
  );

  return legs.reduce((total, leg) => {
    if (leg.id && excludedIds.has(leg.id)) {
      return total;
    }

    if (
      leg.legType !== "OPTION" ||
      leg.legSide !== "SHORT" ||
      leg.optionType !== "CALL" ||
      INACTIVE_CALL_STATUSES.has(leg.legStatus ?? "")
    ) {
      return total;
    }

    return total + toNumber(leg.quantity) * toNumber(leg.multiplier || 1);
  }, 0);
}

export async function syncPositionStatusFromActions(positionId: string) {
  const latestAction = await prisma.positionAction.findFirst({
    where: { positionId },
    orderBy: [{ actionTimestamp: "desc" }, { createdAt: "desc" }],
  });

  await prisma.position.update({
    where: { id: positionId },
    data: {
      currentStatus: (latestAction?.resultingStatus ?? "OPEN") as any,
    },
  });
}
