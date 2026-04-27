function toNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof value === "object" && value !== null && "toString" in value) {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

const ACQUIRE_EVENT_TYPES = new Set(["ACQUIRED", "TRANSFER_IN"]);
const REDUCE_EVENT_TYPES = new Set(["SOLD", "PARTIAL_SELL", "CALLED_AWAY", "TRANSFER_OUT"]);

type HoldingEventLike = {
  eventType: string;
  quantity: unknown;
  eventTimestamp: Date;
  createdAt?: Date;
};

export function parseHoldingNumberInput(value: string | null | undefined) {
  if (!value || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateHoldingStateFromEvents(events: HoldingEventLike[]) {
  const orderedEvents = [...events].sort((left, right) => {
    const timeDiff = left.eventTimestamp.getTime() - right.eventTimestamp.getTime();

    if (timeDiff !== 0) {
      return timeDiff;
    }

    const leftCreatedAt = left.createdAt?.getTime() ?? 0;
    const rightCreatedAt = right.createdAt?.getTime() ?? 0;

    return leftCreatedAt - rightCreatedAt;
  });

  let totalQuantity = 0;
  let remainingQuantity = 0;
  let sawCalledAway = false;
  let sawTransferOut = false;

  for (const event of orderedEvents) {
    const quantity = toNumber(event.quantity);

    if (ACQUIRE_EVENT_TYPES.has(event.eventType)) {
      totalQuantity += quantity;
      remainingQuantity += quantity;
      continue;
    }

    if (REDUCE_EVENT_TYPES.has(event.eventType)) {
      remainingQuantity -= quantity;

      if (event.eventType === "CALLED_AWAY") {
        sawCalledAway = true;
      }

      if (event.eventType === "TRANSFER_OUT") {
        sawTransferOut = true;
      }

      continue;
    }

    if (event.eventType === "ADJUSTMENT") {
      totalQuantity += Math.max(quantity, 0);
      remainingQuantity += quantity;
    }
  }

  const normalizedTotalQuantity = Math.max(totalQuantity, 0);
  const normalizedRemainingQuantity = Math.max(remainingQuantity, 0);

  let holdingStatus: string = "OPEN";
  let closedAt: Date | null = null;

  if (normalizedRemainingQuantity <= 0 && normalizedTotalQuantity > 0) {
    holdingStatus = sawCalledAway ? "CALLED_AWAY" : sawTransferOut ? "TRANSFERRED_OUT" : "CLOSED";
    const latestEvent = orderedEvents.at(-1);
    closedAt = latestEvent?.eventTimestamp ?? null;
  } else if (normalizedRemainingQuantity < normalizedTotalQuantity) {
    holdingStatus = "PARTIALLY_SOLD";
  }

  return {
    orderedEvents,
    quantity: normalizedTotalQuantity,
    remainingQuantity: normalizedRemainingQuantity,
    holdingStatus,
    closedAt,
  };
}

export async function syncHoldingFromEvents(
  holdingId: string,
  prismaClient: {
    holding: {
      findUnique: Function;
      update: Function;
    };
  }
) {
  const holding = await prismaClient.holding.findUnique({
    where: { id: holdingId },
    include: {
      holdingEvents: {
        orderBy: [
          { eventTimestamp: "asc" },
          { createdAt: "asc" },
        ],
      },
    },
  });

  if (!holding) {
    return null;
  }

  const nextState = calculateHoldingStateFromEvents(holding.holdingEvents);

  await prismaClient.holding.update({
    where: { id: holdingId },
    data: {
      quantity: nextState.quantity.toString(),
      openQuantity: nextState.quantity.toString(),
      remainingQuantity: nextState.remainingQuantity.toString(),
      holdingStatus: nextState.holdingStatus as any,
      closedAt: nextState.closedAt,
    },
  });

  return {
    quantity: nextState.quantity,
    remainingQuantity: nextState.remainingQuantity,
    holdingStatus: nextState.holdingStatus,
  };
}
