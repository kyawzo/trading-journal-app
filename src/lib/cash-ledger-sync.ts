import type { CashTxnType } from "@prisma/client";
import { prisma } from "./prisma";

const OPTION_PREMIUM_ACTION_TYPES = new Set([
  "STO",
  "BTO",
  "BTC",
  "STC",
  "ROLL_CREDIT",
  "ROLL_DEBIT",
]);

const CASH_INFLOW_ACTION_TYPES = new Set([
  "STO",
  "STC",
  "ROLL_CREDIT",
  "DIVIDEND",
  "INTEREST",
]);

const CASH_OUTFLOW_ACTION_TYPES = new Set([
  "BTO",
  "BTC",
  "ROLL_DEBIT",
  "EXERCISED",
  "FEE",
]);

const HOLDING_INFLOW_EVENT_TYPES = new Set(["SOLD", "PARTIAL_SELL", "CALLED_AWAY", "DIVIDEND"]);
const HOLDING_OUTFLOW_EVENT_TYPES = new Set(["ACQUIRED"]);

type CashLedgerEntryDraft = {
  brokerAccountId: string | null;
  txnTimestamp: Date;
  txnType: CashTxnType;
  amount: string;
  currency: string;
  linkedPositionId?: string;
  linkedHoldingId?: string;
  description: string;
  externalReference: string;
};

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

function getCashLedgerReference(actionId: string, part: "primary" | "fee") {
  return `POSITION_ACTION:${actionId}:${part}`;
}

function getHoldingEventCashLedgerReference(eventId: string, part: "primary" | "fee") {
  return `HOLDING_EVENT:${eventId}:${part}`;
}

function resolvePositionActionCashAmount(action: {
  actionType: string;
  amount: unknown;
  quantity: unknown;
  premiumPerUnit: unknown;
}) {
  const rawAmount = toNumber(action.amount);

  if (!OPTION_PREMIUM_ACTION_TYPES.has(action.actionType)) {
    return rawAmount;
  }

  const premium = toNumber(action.premiumPerUnit) || rawAmount;

  if (premium === 0) {
    return 0;
  }

  const contractCount = toNumber(action.quantity);
  const normalizedContracts = contractCount > 0 ? contractCount : 1;

  return premium * normalizedContracts * 100;
}

function resolveHoldingEventCashAmount(event: {
  eventType: string;
  amount: unknown;
  quantity: unknown;
  pricePerShare: unknown;
}) {
  const explicitAmount = toNumber(event.amount);

  if (event.eventType === "ADJUSTMENT") {
    return explicitAmount;
  }

  if (explicitAmount !== 0) {
    return Math.abs(explicitAmount);
  }

  const quantity = Math.abs(toNumber(event.quantity));
  const pricePerShare = toNumber(event.pricePerShare);
  return quantity * pricePerShare;
}

function buildPrimaryLedgerEntry(action: {
  id: string;
  actionType: string;
  actionTimestamp: Date;
  amount: unknown;
  quantity: unknown;
  premiumPerUnit: unknown;
  currency: string;
  position: {
    id: string;
    brokerAccountId: string | null;
    underlyingSymbol: string;
  };
}): CashLedgerEntryDraft | null {
  const absoluteAmount = Math.abs(resolvePositionActionCashAmount(action));

  if (absoluteAmount === 0) {
    return null;
  }

  if (CASH_INFLOW_ACTION_TYPES.has(action.actionType)) {
    const txnType: CashTxnType = action.actionType === "DIVIDEND"
      ? "DIVIDEND"
      : action.actionType === "INTEREST"
        ? "INTEREST"
        : "OTHER";

    return {
      brokerAccountId: action.position.brokerAccountId,
      txnTimestamp: action.actionTimestamp,
      txnType,
      amount: absoluteAmount.toString(),
      currency: action.currency || "USD",
      linkedPositionId: action.position.id,
      description: `${action.actionType} cash inflow for ${action.position.underlyingSymbol}`,
      externalReference: getCashLedgerReference(action.id, "primary"),
    };
  }

  if (CASH_OUTFLOW_ACTION_TYPES.has(action.actionType)) {
    const txnType: CashTxnType = action.actionType === "FEE" ? "FEE" : "OTHER";

    return {
      brokerAccountId: action.position.brokerAccountId,
      txnTimestamp: action.actionTimestamp,
      txnType,
      amount: (-absoluteAmount).toString(),
      currency: action.currency || "USD",
      linkedPositionId: action.position.id,
      description: `${action.actionType} cash outflow for ${action.position.underlyingSymbol}`,
      externalReference: getCashLedgerReference(action.id, "primary"),
    };
  }

  return null;
}

function buildFeeLedgerEntry(action: {
  id: string;
  actionType: string;
  actionTimestamp: Date;
  feeAmount: unknown;
  currency: string;
  position: {
    id: string;
    brokerAccountId: string | null;
    underlyingSymbol: string;
  };
}): CashLedgerEntryDraft | null {
  const feeAmount = Math.abs(toNumber(action.feeAmount));

  if (feeAmount === 0) {
    return null;
  }

  return {
    brokerAccountId: action.position.brokerAccountId,
    txnTimestamp: action.actionTimestamp,
    txnType: "COMMISSION",
    amount: (-feeAmount).toString(),
    currency: action.currency || "USD",
    linkedPositionId: action.position.id,
    description: `${action.actionType} fee for ${action.position.underlyingSymbol}`,
    externalReference: getCashLedgerReference(action.id, "fee"),
  };
}

function buildHoldingEventPrimaryLedgerEntry(event: {
  id: string;
  eventType: string;
  eventTimestamp: Date;
  amount: unknown;
  quantity: unknown;
  pricePerShare: unknown;
  currency: string;
  holding: {
    id: string;
    brokerAccountId: string | null;
    symbol: string;
  };
}): CashLedgerEntryDraft | null {
  const amount = resolveHoldingEventCashAmount(event);

  if (amount === 0) {
    return null;
  }

  if (HOLDING_INFLOW_EVENT_TYPES.has(event.eventType)) {
    const txnType: CashTxnType = event.eventType === "DIVIDEND" ? "DIVIDEND" : "OTHER";

    return {
      brokerAccountId: event.holding.brokerAccountId,
      txnTimestamp: event.eventTimestamp,
      txnType,
      amount: Math.abs(amount).toString(),
      currency: event.currency || "USD",
      linkedHoldingId: event.holding.id,
      description: `${event.eventType} cash inflow for ${event.holding.symbol}`,
      externalReference: getHoldingEventCashLedgerReference(event.id, "primary"),
    };
  }

  if (HOLDING_OUTFLOW_EVENT_TYPES.has(event.eventType)) {
    return {
      brokerAccountId: event.holding.brokerAccountId,
      txnTimestamp: event.eventTimestamp,
      txnType: "OTHER",
      amount: (-Math.abs(amount)).toString(),
      currency: event.currency || "USD",
      linkedHoldingId: event.holding.id,
      description: `${event.eventType} cash outflow for ${event.holding.symbol}`,
      externalReference: getHoldingEventCashLedgerReference(event.id, "primary"),
    };
  }

  if (event.eventType === "ADJUSTMENT") {
    return {
      brokerAccountId: event.holding.brokerAccountId,
      txnTimestamp: event.eventTimestamp,
      txnType: "ADJUSTMENT",
      amount: amount.toString(),
      currency: event.currency || "USD",
      linkedHoldingId: event.holding.id,
      description: `${event.eventType} cash adjustment for ${event.holding.symbol}`,
      externalReference: getHoldingEventCashLedgerReference(event.id, "primary"),
    };
  }

  return null;
}

function buildHoldingEventFeeLedgerEntry(event: {
  id: string;
  eventType: string;
  eventTimestamp: Date;
  feeAmount: unknown;
  currency: string;
  holding: {
    id: string;
    brokerAccountId: string | null;
    symbol: string;
  };
}): CashLedgerEntryDraft | null {
  const feeAmount = Math.abs(toNumber(event.feeAmount));

  if (feeAmount === 0) {
    return null;
  }

  return {
    brokerAccountId: event.holding.brokerAccountId,
    txnTimestamp: event.eventTimestamp,
    txnType: "COMMISSION",
    amount: (-feeAmount).toString(),
    currency: event.currency || "USD",
    linkedHoldingId: event.holding.id,
    description: `${event.eventType} fee for ${event.holding.symbol}`,
    externalReference: getHoldingEventCashLedgerReference(event.id, "fee"),
  };
}

export async function deleteCashLedgerEntriesForPositionAction(actionId: string) {
  await prisma.cashLedger.deleteMany({
    where: {
      externalReference: {
        in: [
          getCashLedgerReference(actionId, "primary"),
          getCashLedgerReference(actionId, "fee"),
        ],
      },
    },
  });
}

export async function syncCashLedgerEntriesForPositionAction(actionId: string) {
  await prisma.$transaction(async (tx) => {
    const action = await tx.positionAction.findUnique({
      where: { id: actionId },
      include: {
        position: {
          select: {
            id: true,
            brokerAccountId: true,
            underlyingSymbol: true,
          },
        },
      },
    });

    if (!action) {
      return;
    }

    await tx.cashLedger.deleteMany({
      where: {
        externalReference: {
          in: [
            getCashLedgerReference(actionId, "primary"),
            getCashLedgerReference(actionId, "fee"),
          ],
        },
      },
    });

    const entries = [
      buildPrimaryLedgerEntry(action),
      buildFeeLedgerEntry(action),
    ].filter((entry): entry is CashLedgerEntryDraft => entry !== null);

    if (entries.length === 0) {
      return;
    }

    await tx.cashLedger.createMany({
      data: entries,
    });
  });
}

export async function deleteCashLedgerEntriesForHoldingEvent(eventId: string) {
  await prisma.cashLedger.deleteMany({
    where: {
      externalReference: {
        in: [
          getHoldingEventCashLedgerReference(eventId, "primary"),
          getHoldingEventCashLedgerReference(eventId, "fee"),
        ],
      },
    },
  });
}

export async function syncCashLedgerEntriesForHoldingEvent(eventId: string) {
  await prisma.$transaction(async (tx) => {
    const event = await tx.holdingEvent.findUnique({
      where: { id: eventId },
      include: {
        holding: {
          select: {
            id: true,
            brokerAccountId: true,
            symbol: true,
          },
        },
      },
    });

    if (!event) {
      return;
    }

    await tx.cashLedger.deleteMany({
      where: {
        externalReference: {
          in: [
            getHoldingEventCashLedgerReference(eventId, "primary"),
            getHoldingEventCashLedgerReference(eventId, "fee"),
          ],
        },
      },
    });

    const entries = [
      buildHoldingEventPrimaryLedgerEntry(event),
      buildHoldingEventFeeLedgerEntry(event),
    ].filter((entry): entry is CashLedgerEntryDraft => entry !== null);

    if (entries.length === 0) {
      return;
    }

    await tx.cashLedger.createMany({
      data: entries,
    });
  });
}
