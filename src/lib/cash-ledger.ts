const POSITIVE_CASH_TXN_TYPES = new Set([
  "DEPOSIT",
  "DIVIDEND",
  "INTEREST",
  "TRANSFER_IN",
]);

const NEGATIVE_CASH_TXN_TYPES = new Set([
  "WITHDRAWAL",
  "FEE",
  "COMMISSION",
  "TAX",
  "TRANSFER_OUT",
]);

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

export function normalizeCashLedgerAmount(txnType: string, amount: number) {
  const normalized = Math.abs(amount);

  if (POSITIVE_CASH_TXN_TYPES.has(txnType)) {
    return normalized;
  }

  if (NEGATIVE_CASH_TXN_TYPES.has(txnType)) {
    return -normalized;
  }

  return amount;
}

export function calculateCashLedgerSummary(
  entries: Array<{
    txnType: string;
    amount: unknown;
    currency: string;
  }>
) {
  let currentBalance = 0;
  let totalInflows = 0;
  let totalOutflows = 0;
  let currency = "USD";

  for (const entry of entries) {
    const amount = toNumber(entry.amount);

    currency = entry.currency || currency;
    currentBalance += amount;

    if (amount > 0) {
      totalInflows += amount;
    }

    if (amount < 0) {
      totalOutflows += Math.abs(amount);
    }
  }

  return {
    currentBalance,
    totalInflows,
    totalOutflows,
    currency,
  };
}

export function attachRunningBalances<T extends {
  amount: unknown;
  txnTimestamp: Date;
  createdAt?: Date;
}>(entries: T[]) {
  const ordered = [...entries].sort((left, right) => {
    const timeDiff = left.txnTimestamp.getTime() - right.txnTimestamp.getTime();

    if (timeDiff !== 0) {
      return timeDiff;
    }

    const leftCreatedAt = left.createdAt?.getTime() ?? 0;
    const rightCreatedAt = right.createdAt?.getTime() ?? 0;

    return leftCreatedAt - rightCreatedAt;
  });

  let runningBalance = 0;

  return ordered.map((entry) => {
    runningBalance += toNumber(entry.amount);

    return {
      ...entry,
      signedAmount: toNumber(entry.amount),
      runningBalance,
    };
  });
}
