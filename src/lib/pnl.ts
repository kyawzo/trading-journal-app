const CREDIT_ACTION_TYPES = new Set([
  "STO",
  "STC",
  "ROLL_CREDIT",
  "DIVIDEND",
  "INTEREST",
  "EXPIRED_WORTHLESS",
]);

const DEBIT_ACTION_TYPES = new Set([
  "BTO",
  "BTC",
  "ROLL_DEBIT",
  "FEE",
  "EXERCISED",
]);

const OPTION_PREMIUM_ACTION_TYPES = new Set([
  "STO",
  "BTO",
  "BTC",
  "STC",
  "ROLL_CREDIT",
  "ROLL_DEBIT",
]);

const SELL_EVENT_TYPES = new Set(["SOLD", "PARTIAL_SELL", "CALLED_AWAY"]);
const BUY_EVENT_TYPES = new Set(["ACQUIRED", "TRANSFER_IN"]);
const DEFAULT_OPTION_CONTRACT_MULTIPLIER = 100;

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

function resolveActionCashAmount(action: {
  actionType: string;
  amount: unknown;
  quantity?: unknown;
  premiumPerUnit?: unknown;
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

  return premium * normalizedContracts * DEFAULT_OPTION_CONTRACT_MULTIPLIER;
}

export function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

export function calculatePositionPnlSummary(
  actions: Array<{
    actionType: string;
    amount: unknown;
    feeAmount: unknown;
    currency: string;
    quantity?: unknown;
    premiumPerUnit?: unknown;
  }>
) {
  let grossCredits = 0;
  let grossDebits = 0;
  let totalFees = 0;
  let ignoredAmountCount = 0;
  let currency = "USD";

  for (const action of actions) {
    currency = action.currency || currency;

    const amount = resolveActionCashAmount(action);
    const normalizedAmount = Math.abs(amount);
    const fee = Math.abs(toNumber(action.feeAmount));

    totalFees += fee;

    if (normalizedAmount === 0) {
      continue;
    }

    if (CREDIT_ACTION_TYPES.has(action.actionType)) {
      grossCredits += normalizedAmount;
      continue;
    }

    if (DEBIT_ACTION_TYPES.has(action.actionType)) {
      grossDebits += normalizedAmount;
      continue;
    }

    ignoredAmountCount += 1;
  }

  return {
    currency,
    grossCredits,
    grossDebits,
    totalFees,
    netCashFlow: grossCredits - grossDebits - totalFees,
    ignoredAmountCount,
  };
}

export function calculateHoldingPnlSummary(holding: {
  costBasisPerShare: unknown;
  remainingQuantity: unknown;
  holdingEvents: Array<{
    eventType: string;
    quantity: unknown;
    pricePerShare: unknown;
    amount: unknown;
    feeAmount: unknown;
    currency: string;
  }>;
}) {
  const costBasisPerShare = toNumber(holding.costBasisPerShare);
  const remainingQuantity = toNumber(holding.remainingQuantity);

  let acquiredShares = 0;
  let soldShares = 0;
  let grossPurchaseCost = 0;
  let grossSaleProceeds = 0;
  let acquisitionFees = 0;
  let dispositionFees = 0;
  let totalFees = 0;
  let currency = "USD";

  for (const event of holding.holdingEvents) {
    currency = event.currency || currency;

    const quantity = toNumber(event.quantity);
    const fee = Math.abs(toNumber(event.feeAmount));
    const explicitAmount = Math.abs(toNumber(event.amount));
    const pricePerShare = toNumber(event.pricePerShare);
    const fallbackAmount = quantity * pricePerShare;
    const amount = explicitAmount || fallbackAmount;

    totalFees += fee;

    if (BUY_EVENT_TYPES.has(event.eventType)) {
      acquiredShares += quantity;
      grossPurchaseCost += amount;
      acquisitionFees += fee;
    }

    if (SELL_EVENT_TYPES.has(event.eventType)) {
      soldShares += quantity;
      grossSaleProceeds += amount;
      dispositionFees += fee;
    }
  }

  const effectiveCostBasisPerShare = acquiredShares > 0
    ? (grossPurchaseCost + acquisitionFees) / acquiredShares
    : costBasisPerShare;
  const estimatedCostOfSoldShares = soldShares * effectiveCostBasisPerShare;
  const estimatedRealizedPnl = grossSaleProceeds - estimatedCostOfSoldShares - dispositionFees;
  const estimatedOpenCost = remainingQuantity * effectiveCostBasisPerShare;

  return {
    currency,
    acquiredShares,
    soldShares,
    grossPurchaseCost,
    grossSaleProceeds,
    acquisitionFees,
    dispositionFees,
    totalFees,
    effectiveCostBasisPerShare,
    estimatedCostOfSoldShares,
    estimatedRealizedPnl,
    estimatedOpenCost,
  };
}
