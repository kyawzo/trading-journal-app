import {
  ActionEffectType,
  AssetClass,
  CashTxnType,
  HoldingEventType,
  HoldingSourceType,
  HoldingStatus,
  ImportBatchStatus,
  ImportSourceType,
  LegSide,
  LegStatus,
  LegType,
  OptionType,
  PositionActionType,
  PositionSourceType,
  PositionStatus,
  RawTransactionType,
  StrategyType,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { syncPnlSnapshotsForImportBatch } from "@/src/lib/pnl-snapshots";
import { prisma } from "@/src/lib/prisma";
import { getPositionStrategyLegTemplate } from "@/src/lib/position-leg-templates";
import { normalizeTigerTradeRows, type TigerNormalizedTradeRow } from "./normalize";

const IMPORTER_VERSION = "tiger-v1-option-expiry";
const STOCK_PURCHASE_TXN_TYPE = "STOCK_PURCHASE" as CashTxnType;
const STOCK_SALE_TXN_TYPE = "STOCK_SALE" as CashTxnType;

type TigerOptionLeg = {
  underlyingSymbol: string;
  optionType: OptionType;
  expiryDate: Date;
  strikePrice: number;
};

type TigerOptionBundle = {
  seedRowNumber: number;
  componentRows: TigerNormalizedTradeRow[];
  quantity: number;
  actionType: PositionActionType;
  premiumPerUnit: number;
  feeAmount: number;
  spreadLegs: TigerOptionLeg[];
};

type TigerOptionRoll = {
  seedRowNumber: number;
  componentRows: TigerNormalizedTradeRow[];
  quantity: number;
  feeAmount: number;
  premiumPerUnit: number;
  netAmount: number;
  closingActionType: PositionActionType;
  openingActionType: PositionActionType;
  closingLegs: TigerOptionLeg[];
  openingLegs: TigerOptionLeg[];
};

type TigerOptionExpiryBundle = {
  seedRowNumber: number;
  componentRows: TigerNormalizedTradeRow[];
  quantity: number;
  expiredLegs: TigerOptionLeg[];
};

type ImportTigerCsvInput = {
  brokerAccountId: string;
  fileName: string;
  csvText: string;
};

export type ImportTigerCsvResult = {
  importBatchId: string;
  fileHash: string;
  summary: {
    totalRows: number;
    processableRows: number;
    skippedRows: number;
    importedRows: number;
    failedRows: number;
    holdingsCreated: number;
    holdingEventsCreated: number;
    positionsCreated: number;
    positionActionsCreated: number;
    rawTransactionsCreated: number;
    cashLedgerEntriesCreated: number;
  };
  failures: Array<{
    rowNumber: number;
    symbol: string;
    reason: string;
  }>;
};

function toDecimalString(value: number) {
  return value.toString();
}

function toDateOrNow(value: string | null) {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getImportReference(importBatchId: string, rowNumber: number) {
  return `IMPORT:${importBatchId}:ROW:${rowNumber}`;
}

function sortRowsForProcessing(rows: TigerNormalizedTradeRow[]) {
  return [...rows].sort((left, right) => {
    const leftTs = left.orderTimestamp
      ? new Date(left.orderTimestamp).getTime()
      : left.fillTimestamp
        ? new Date(left.fillTimestamp).getTime()
        : left.eventTimestamp
          ? new Date(left.eventTimestamp).getTime()
          : Number.MAX_SAFE_INTEGER;
    const rightTs = right.orderTimestamp
      ? new Date(right.orderTimestamp).getTime()
      : right.fillTimestamp
        ? new Date(right.fillTimestamp).getTime()
        : right.eventTimestamp
          ? new Date(right.eventTimestamp).getTime()
          : Number.MAX_SAFE_INTEGER;

    if (leftTs !== rightTs) {
      return leftTs - rightTs;
    }

    return left.rowNumber - right.rowNumber;
  });
}

function normalizeUnderlyingFamily(symbol: string) {
  return symbol.endsWith("W") && symbol.length > 3 ? symbol.slice(0, -1) : symbol;
}

function isSameContractDate(left: Date | null | undefined, right: Date | null | undefined) {
  if (!left || !right) {
    return false;
  }

  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

function getDaysToExpiry(actionTimestamp: Date, expiryDate: Date) {
  const normalizedActionDate = Date.UTC(
    actionTimestamp.getUTCFullYear(),
    actionTimestamp.getUTCMonth(),
    actionTimestamp.getUTCDate(),
  );
  const normalizedExpiryDate = Date.UTC(
    expiryDate.getUTCFullYear(),
    expiryDate.getUTCMonth(),
    expiryDate.getUTCDate(),
  );

  return (normalizedExpiryDate - normalizedActionDate) / (1000 * 60 * 60 * 24);
}

function inferSingleLegRoleForStrategy(input: {
  strategyType: StrategyType;
  legSide: LegSide;
  optionType: OptionType | null;
}) {
  const template = getPositionStrategyLegTemplate(input.strategyType);
  if (!template || template.legs.length !== 1) {
    return "SINGLE";
  }

  const [templateLeg] = template.legs;
  if (templateLeg.legType !== "OPTION") {
    return templateLeg.legRole;
  }

  const normalizedOptionType = input.optionType;
  if (
    templateLeg.legSide === input.legSide &&
    (templateLeg.optionType ?? null) === normalizedOptionType
  ) {
    return templateLeg.legRole;
  }

  return templateLeg.legRole;
}

function deriveStrategyTypeForSpreadPosition(input: {
  spreadLegs: TigerOptionLeg[];
  actionType: PositionActionType;
}) {
  if (input.spreadLegs.length === 4) {
    const putLegs = input.spreadLegs
      .filter((leg) => leg.optionType === OptionType.PUT)
      .sort((left, right) => left.strikePrice - right.strikePrice);
    const callLegs = input.spreadLegs
      .filter((leg) => leg.optionType === OptionType.CALL)
      .sort((left, right) => left.strikePrice - right.strikePrice);

    if (putLegs.length !== 2 || callLegs.length !== 2) {
      return StrategyType.CUSTOM;
    }

    const expiries = new Set(input.spreadLegs.map((leg) => leg.expiryDate.toISOString().slice(0, 10)));
    if (expiries.size !== 1) {
      return StrategyType.CUSTOM;
    }

    return StrategyType.IRON_CONDOR;
  }

  const [firstLeg, secondLeg] = input.spreadLegs;
  if (!firstLeg || !secondLeg) {
    return StrategyType.CUSTOM;
  }

  const sameExpiry = isSameContractDate(firstLeg.expiryDate, secondLeg.expiryDate);
  if (!sameExpiry) {
    return StrategyType.CUSTOM;
  }

  if (firstLeg.optionType === OptionType.PUT && secondLeg.optionType === OptionType.PUT) {
    return input.actionType === PositionActionType.STO
      ? StrategyType.BULL_PUT_SPREAD
      : StrategyType.BEAR_PUT_SPREAD;
  }

  if (firstLeg.optionType === OptionType.CALL && secondLeg.optionType === OptionType.CALL) {
    return input.actionType === PositionActionType.STO
      ? StrategyType.BEAR_CALL_SPREAD
      : StrategyType.BULL_CALL_SPREAD;
  }

  return StrategyType.CUSTOM;
}

function buildSpreadLegBlueprints(input: {
  spreadLegs: TigerOptionLeg[];
  strategyType: StrategyType;
}) {
  if (input.strategyType === StrategyType.IRON_CONDOR) {
    const putLegs = input.spreadLegs
      .filter((leg) => leg.optionType === OptionType.PUT)
      .sort((left, right) => left.strikePrice - right.strikePrice);
    const callLegs = input.spreadLegs
      .filter((leg) => leg.optionType === OptionType.CALL)
      .sort((left, right) => left.strikePrice - right.strikePrice);

    const [longPutWing, shortPut] = putLegs;
    const [shortCall, longCallWing] = callLegs;

    if (!longPutWing || !shortPut || !shortCall || !longCallWing) {
      return [];
    }

    return [
      { ...longPutWing, legSide: LegSide.LONG, legRole: "LONG_PUT_WING" },
      { ...shortPut, legSide: LegSide.SHORT, legRole: "SHORT_PUT" },
      { ...shortCall, legSide: LegSide.SHORT, legRole: "SHORT_CALL" },
      { ...longCallWing, legSide: LegSide.LONG, legRole: "LONG_CALL_WING" },
    ];
  }

  const sortedLegs = [...input.spreadLegs].sort((left, right) => left.strikePrice - right.strikePrice);
  const [lowLeg, highLeg] = sortedLegs;

  if (!lowLeg || !highLeg) {
    return [];
  }

  switch (input.strategyType) {
    case StrategyType.BULL_PUT_SPREAD:
      return [
        { ...lowLeg, legSide: LegSide.LONG, legRole: "LONG_PUT" },
        { ...highLeg, legSide: LegSide.SHORT, legRole: "SHORT_PUT" },
      ];
    case StrategyType.BEAR_PUT_SPREAD:
      return [
        { ...lowLeg, legSide: LegSide.SHORT, legRole: "SHORT_PUT" },
        { ...highLeg, legSide: LegSide.LONG, legRole: "LONG_PUT" },
      ];
    case StrategyType.BEAR_CALL_SPREAD:
      return [
        { ...lowLeg, legSide: LegSide.SHORT, legRole: "SHORT_CALL" },
        { ...highLeg, legSide: LegSide.LONG, legRole: "LONG_CALL" },
      ];
    case StrategyType.BULL_CALL_SPREAD:
      return [
        { ...lowLeg, legSide: LegSide.LONG, legRole: "LONG_CALL" },
        { ...highLeg, legSide: LegSide.SHORT, legRole: "SHORT_CALL" },
      ];
    default:
      return input.spreadLegs.map((leg, index) => ({
        ...leg,
        legSide: index === 0 ? LegSide.SHORT : LegSide.LONG,
        legRole: `SPREAD_LEG_${index + 1}`,
      }));
  }
}

function getTigerOptionDetails(symbol: string) {
  const match = symbol.match(/^([A-Z.]+)\s+(\d{8})\s+(PUT|CALL)\s+([\d.]+)$/i);
  if (!match) {
    return null;
  }

  const [, underlyingSymbol, expiryRaw, optionTypeRaw, strikeRaw] = match;
  const year = Number(expiryRaw.slice(0, 4));
  const month = Number(expiryRaw.slice(4, 6));
  const day = Number(expiryRaw.slice(6, 8));
  const strikePrice = Number(strikeRaw);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(strikePrice)) {
    return null;
  }

  return {
    underlyingSymbol: underlyingSymbol.toUpperCase(),
    optionType: optionTypeRaw.toUpperCase() === "CALL" ? OptionType.CALL : OptionType.PUT,
    expiryDate: new Date(Date.UTC(year, month - 1, day)),
    strikePrice,
  };
}

async function findCoveredCallHolding(input: {
  brokerAccountId: string;
  underlyingSymbol: string;
  requiredShares: number;
}) {
  const requiredShares = Math.max(0, input.requiredShares);

  return prisma.holding.findFirst({
    where: {
      brokerAccountId: input.brokerAccountId,
      symbol: input.underlyingSymbol,
      holdingStatus: {
        in: [HoldingStatus.OPEN, HoldingStatus.PARTIALLY_SOLD],
      },
      remainingQuantity: {
        gte: toDecimalString(requiredShares),
      },
    },
    orderBy: [{ openedAt: "asc" }, { createdAt: "asc" }],
  });
}

async function deriveStrategyTypeForNewTigerOptionPosition(input: {
  brokerAccountId: string;
  underlyingSymbol: string;
  optionDetails: NonNullable<ReturnType<typeof getTigerOptionDetails>>;
  actionType: PositionActionType;
  actionTimestamp: Date;
}) {
  const { brokerAccountId, underlyingSymbol, optionDetails, actionType, actionTimestamp } = input;

  if (actionType === PositionActionType.STO) {
    if (optionDetails.optionType === OptionType.PUT) {
      return StrategyType.CSP;
    }

    if (optionDetails.optionType === OptionType.CALL) {
      const linkedHolding = await findCoveredCallHolding({
        brokerAccountId,
        underlyingSymbol,
        requiredShares: 100,
      });

      return linkedHolding ? StrategyType.CC : StrategyType.SHORT_CALL;
    }

    return StrategyType.CUSTOM;
  }

  const daysToExpiry = getDaysToExpiry(actionTimestamp, optionDetails.expiryDate);
  const isLeaps = daysToExpiry >= 270;

  if (optionDetails.optionType === OptionType.CALL) {
    return isLeaps ? StrategyType.LEAPS_CALL : StrategyType.LONG_CALL;
  }

  if (optionDetails.optionType === OptionType.PUT) {
    return isLeaps ? StrategyType.LEAPS_PUT : StrategyType.LONG_PUT;
  }

  return StrategyType.CUSTOM;
}

async function findMatchingOpenTigerOptionPosition(
  brokerAccountId: string,
  row: TigerNormalizedTradeRow,
  optionDetails: NonNullable<ReturnType<typeof getTigerOptionDetails>>,
  legSide: LegSide,
) {
  const normalizedUnderlying = normalizeUnderlyingFamily(row.underlyingSymbol);
  const underlyingVariants = Array.from(new Set([normalizedUnderlying, `${normalizedUnderlying}W`]));

  const candidates = await prisma.position.findMany({
    where: {
      brokerAccountId,
      assetClass: AssetClass.OPTION,
      underlyingSymbol: {
        in: underlyingVariants,
      },
      currentStatus: {
        in: [PositionStatus.OPEN, PositionStatus.PARTIALLY_CLOSED],
      },
    },
    include: {
      legs: true,
    },
    orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  const strictMatches: Array<{ position: (typeof candidates)[number]; leg: (typeof candidates)[number]["legs"][number] }> = [];
  const fallbackMatches: Array<{ position: (typeof candidates)[number]; leg: (typeof candidates)[number]["legs"][number] }> = [];

  for (const position of candidates) {
    const strictLeg = position.legs.find((leg) => (
      leg.legType === LegType.OPTION &&
      leg.legSide === legSide &&
      leg.optionType === optionDetails.optionType &&
      isSameContractDate(leg.expiryDate as Date | null, optionDetails.expiryDate) &&
      Number(leg.strikePrice?.toString() ?? "0") === optionDetails.strikePrice &&
      (leg.legStatus === LegStatus.OPEN || leg.legStatus === LegStatus.PARTIALLY_CLOSED)
    ));

    if (strictLeg) {
      strictMatches.push({ position, leg: strictLeg });
      continue;
    }

    const softLeg = position.legs.find((leg) => (
      leg.legType === LegType.OPTION &&
      leg.legSide === legSide &&
      leg.optionType === optionDetails.optionType &&
      (leg.legStatus === LegStatus.OPEN || leg.legStatus === LegStatus.PARTIALLY_CLOSED)
    ));

    if (!softLeg) {
      continue;
    }

    if ((position.positionTitle ?? "").trim() === (row.name ?? "").trim()) {
      fallbackMatches.push({ position, leg: softLeg });
    }
  }

  if (strictMatches.length > 0) {
    return strictMatches[0];
  }

  if (fallbackMatches.length > 0) {
    return fallbackMatches[0];
  }

  return null;
}

function getTigerSpreadLegContractKey(leg: TigerOptionLeg) {
  return `${leg.optionType}:${leg.expiryDate.toISOString().slice(0, 10)}:${leg.strikePrice.toFixed(4)}`;
}

function getTigerPositionLegContractKey(leg: {
  optionType: OptionType | null;
  expiryDate: Date | null;
  strikePrice: { toString(): string } | null;
}) {
  if (!leg.optionType || !leg.expiryDate || !leg.strikePrice) {
    return null;
  }

  return `${leg.optionType}:${leg.expiryDate.toISOString().slice(0, 10)}:${Number(leg.strikePrice.toString()).toFixed(4)}`;
}

async function findMatchingOpenTigerSpreadPosition(input: {
  brokerAccountId: string;
  underlyingSymbol: string;
  spreadLegs: TigerOptionLeg[];
}) {
  const expectedKeys = new Set(input.spreadLegs.map(getTigerSpreadLegContractKey));
  const normalizedUnderlying = normalizeUnderlyingFamily(input.underlyingSymbol);
  const underlyingVariants = Array.from(new Set([normalizedUnderlying, `${normalizedUnderlying}W`]));

  const candidates = await prisma.position.findMany({
    where: {
      brokerAccountId: input.brokerAccountId,
      underlyingSymbol: {
        in: underlyingVariants,
      },
      assetClass: AssetClass.OPTION,
      currentStatus: {
        in: [PositionStatus.OPEN, PositionStatus.PARTIALLY_CLOSED],
      },
    },
    include: {
      actions: {
        orderBy: [{ actionTimestamp: "asc" }, { createdAt: "asc" }],
      },
      legs: {
        orderBy: [{ openedAt: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  for (const position of candidates) {
    const activeOptionLegs = position.legs.filter((leg) => (
      leg.legType === LegType.OPTION &&
      (leg.legStatus === LegStatus.OPEN || leg.legStatus === LegStatus.PARTIALLY_CLOSED)
    ));

    if (activeOptionLegs.length !== input.spreadLegs.length) {
      continue;
    }

    const actualKeys = new Set(activeOptionLegs.map((leg) => getTigerPositionLegContractKey({
      optionType: leg.optionType as OptionType | null,
      expiryDate: leg.expiryDate as Date | null,
      strikePrice: leg.strikePrice,
    })));

    const keysMatch = (
      actualKeys.size === expectedKeys.size &&
      [...expectedKeys].every((key) => actualKeys.has(key))
    );

    if (keysMatch) {
      return {
        position,
        activeOptionLegs,
      };
    }
  }

  return null;
}

async function findOpenTigerPositionsCoveringSpreadLegs(input: {
  brokerAccountId: string;
  underlyingSymbol: string;
  spreadLegs: TigerOptionLeg[];
}) {
  const expectedKeys = new Set(input.spreadLegs.map(getTigerSpreadLegContractKey));
  const normalizedUnderlying = normalizeUnderlyingFamily(input.underlyingSymbol);
  const underlyingVariants = Array.from(new Set([normalizedUnderlying, `${normalizedUnderlying}W`]));

  const candidates = await prisma.position.findMany({
    where: {
      brokerAccountId: input.brokerAccountId,
      underlyingSymbol: {
        in: underlyingVariants,
      },
      assetClass: AssetClass.OPTION,
      currentStatus: {
        in: [PositionStatus.OPEN, PositionStatus.PARTIALLY_CLOSED],
      },
    },
    include: {
      legs: true,
    },
    orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  const matches = candidates
    .map((position) => {
      const matchingActiveLegs = position.legs.filter((leg) => {
        if (leg.legType !== LegType.OPTION || !isActiveLegStatus(leg.legStatus as LegStatus)) {
          return false;
        }

        const optionType = leg.optionType as OptionType | null;
        const expiryDate = leg.expiryDate as Date | null;
        const strikePrice = Number(leg.strikePrice?.toString() ?? "NaN");
        if (!optionType || !expiryDate || !Number.isFinite(strikePrice)) {
          return false;
        }

        return expectedKeys.has(getTigerSpreadLegContractKey({
          underlyingSymbol: leg.underlyingSymbol,
          optionType,
          expiryDate,
          strikePrice,
        }));
      });

      return matchingActiveLegs.length > 0
        ? { position, matchingActiveLegs }
        : null;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  const coveredKeys = new Set(
    matches.flatMap((candidate) => candidate.matchingActiveLegs.map((leg) => {
      const optionType = leg.optionType as OptionType | null;
      const expiryDate = leg.expiryDate as Date | null;
      const strikePrice = Number(leg.strikePrice?.toString() ?? "NaN");
      if (!optionType || !expiryDate || !Number.isFinite(strikePrice)) {
        return "INVALID";
      }

      return getTigerSpreadLegContractKey({
        underlyingSymbol: leg.underlyingSymbol,
        optionType,
        expiryDate,
        strikePrice,
      });
    })),
  );

  if (![...expectedKeys].every((key) => coveredKeys.has(key))) {
    return null;
  }

  return matches;
}

function isActiveLegStatus(status: LegStatus) {
  return status === LegStatus.OPEN || status === LegStatus.PARTIALLY_CLOSED;
}

async function derivePositionStatusFromLegs(positionId: string) {
  const optionLegs = await prisma.positionLeg.findMany({
    where: {
      positionId,
      legType: LegType.OPTION,
    },
    select: {
      legStatus: true,
    },
  });

  const activeLegs = optionLegs.filter((leg) => isActiveLegStatus(leg.legStatus as LegStatus));
  if (activeLegs.length === 0) {
    return PositionStatus.CLOSED;
  }

  const hasPartialOrInactive = optionLegs.some((leg) => leg.legStatus !== LegStatus.OPEN);
  return hasPartialOrInactive ? PositionStatus.PARTIALLY_CLOSED : PositionStatus.OPEN;
}

function buildTigerOptionBundleRowNumbers(rows: TigerNormalizedTradeRow[]) {
  const groupedRows = new Map<string, TigerNormalizedTradeRow[]>();

  for (const row of rows) {
    if (
      row.skipReason !== null ||
      row.assetType !== "POSITION" ||
      row.sourceSection !== "Trades" ||
      !row.eventTimestamp
    ) {
      continue;
    }

    const quantity = Math.abs(row.quantity ?? 0);
    const groupKey = `${row.underlyingSymbol}|${row.eventTimestamp}|${quantity}`;
    const bucket = groupedRows.get(groupKey) ?? [];
    bucket.push(row);
    groupedRows.set(groupKey, bucket);
  }

  const bundlesBySeedRowNumber = new Map<number, TigerOptionBundle>();
  const rollsBySeedRowNumber = new Map<number, TigerOptionRoll>();
  const consumedComponentRowNumbers = new Set<number>();
  const unsupportedBundledRowNumbers = new Set<number>();

  for (const bucket of groupedRows.values()) {
    if (bucket.length <= 1) {
      continue;
    }

    try {
      const resolvedRows = bucket.map((row) => ({
        row,
        action: resolveTigerOptionAction(row),
        details: getTigerOptionDetails(row.symbol),
      }));

      if (resolvedRows.some((item) => item.details === null)) {
        for (const item of resolvedRows) {
          unsupportedBundledRowNumbers.add(item.row.rowNumber);
        }
        continue;
      }

      const actions = resolvedRows.map((item) => item.action);
      const firstQuantity = actions[0]?.quantity ?? 0;
      const sameQuantity = actions.every((action) => Math.abs(action.quantity - firstQuantity) <= 0.000001);

      if (!sameQuantity) {
        for (const item of resolvedRows) {
          unsupportedBundledRowNumbers.add(item.row.rowNumber);
        }
        continue;
      }

      const orderedRows = [...bucket].sort((left, right) => left.rowNumber - right.rowNumber);
      const seedRowNumber = orderedRows[0]?.rowNumber;
      if (!seedRowNumber) {
        continue;
      }

      const openingRows = resolvedRows.filter((item) => item.action.opening);
      const closingRows = resolvedRows.filter((item) => !item.action.opening);
      const openingLegs = openingRows.map((item) => ({
        underlyingSymbol: item.details!.underlyingSymbol,
        optionType: item.details!.optionType,
        expiryDate: item.details!.expiryDate,
        strikePrice: item.details!.strikePrice,
      }));
      const closingLegs = closingRows.map((item) => ({
        underlyingSymbol: item.details!.underlyingSymbol,
        optionType: item.details!.optionType,
        expiryDate: item.details!.expiryDate,
        strikePrice: item.details!.strikePrice,
      }));

      const totalAmount = resolvedRows.reduce((sum, item) => (
        sum + Math.abs(item.row.amount ?? 0) * (
          (item.action.legSide === LegSide.SHORT && item.action.opening) ||
          (item.action.legSide === LegSide.LONG && !item.action.opening)
            ? -1
            : 1
        )
      ), 0);
      const feeAmount = resolvedRows.reduce((sum, item) => sum + Math.abs(item.row.feeAmount ?? 0), 0);

      if (openingRows.length > 0 && closingRows.length > 0) {
        const openingNetAmount = openingRows.reduce((sum, item) => (
          sum + Math.abs(item.row.amount ?? 0) * (
            item.action.legSide === LegSide.SHORT ? -1 : 1
          )
        ), 0);
        const closingNetAmount = closingRows.reduce((sum, item) => (
          sum + Math.abs(item.row.amount ?? 0) * (
            item.action.legSide === LegSide.SHORT ? 1 : -1
          )
        ), 0);
        const openingActionType = openingNetAmount <= 0 ? PositionActionType.STO : PositionActionType.BTO;
        const closingActionType = closingRows.length === 1
          ? closingRows[0]?.action.actionType
          : closingNetAmount >= 0
            ? PositionActionType.BTC
            : PositionActionType.STC;

        const openingStrategy = deriveStrategyTypeForSpreadPosition({
          spreadLegs: openingLegs,
          actionType: openingActionType,
        });
        const closingStrategy = deriveStrategyTypeForSpreadPosition({
          spreadLegs: closingLegs,
          actionType: closingActionType === PositionActionType.BTC ? PositionActionType.STO : PositionActionType.BTO,
        });

        const isSingleLegRoll = openingRows.length === 1 && closingRows.length === 1;
        const isSupportedBundleRoll = (
          (openingRows.length === 2 && closingRows.length === 2 && openingStrategy !== StrategyType.CUSTOM && closingStrategy !== StrategyType.CUSTOM) ||
          (openingRows.length === 4 && closingRows.length === 4 && openingStrategy === StrategyType.IRON_CONDOR && closingStrategy === StrategyType.IRON_CONDOR)
        );

        if (!isSingleLegRoll && !isSupportedBundleRoll) {
          for (const item of resolvedRows) {
            unsupportedBundledRowNumbers.add(item.row.rowNumber);
          }
          continue;
        }

        rollsBySeedRowNumber.set(seedRowNumber, {
          seedRowNumber,
          componentRows: orderedRows,
          quantity: firstQuantity,
          feeAmount,
          premiumPerUnit: firstQuantity > 0 ? Math.abs(totalAmount) / (firstQuantity * 100) : 0,
          netAmount: totalAmount,
          closingActionType,
          openingActionType,
          closingLegs,
          openingLegs,
        });

        for (const row of orderedRows.slice(1)) {
          consumedComponentRowNumbers.add(row.rowNumber);
        }
        continue;
      }

      const sameOpeningIntent = actions.every((action) => action.opening === actions[0]?.opening);
      if (!sameOpeningIntent) {
        for (const item of resolvedRows) {
          unsupportedBundledRowNumbers.add(item.row.rowNumber);
        }
        continue;
      }

      const spreadLegs = resolvedRows.map((item) => ({
        underlyingSymbol: item.details!.underlyingSymbol,
        optionType: item.details!.optionType,
        expiryDate: item.details!.expiryDate,
        strikePrice: item.details!.strikePrice,
      }));

      const distinctExpiries = new Set(spreadLegs.map((leg) => leg.expiryDate.toISOString().slice(0, 10)));
      const shortLegCount = actions.filter((action) => action.legSide === LegSide.SHORT).length;
      const longLegCount = actions.filter((action) => action.legSide === LegSide.LONG).length;
      const putCount = spreadLegs.filter((leg) => leg.optionType === OptionType.PUT).length;
      const callCount = spreadLegs.filter((leg) => leg.optionType === OptionType.CALL).length;

      const isVertical = (
        bucket.length === 2 &&
        distinctExpiries.size === 1 &&
        shortLegCount === 1 &&
        longLegCount === 1 &&
        (putCount === 2 || callCount === 2)
      );

      const isIronCondor = (
        bucket.length === 4 &&
        distinctExpiries.size === 1 &&
        shortLegCount === 2 &&
        longLegCount === 2 &&
        putCount === 2 &&
        callCount === 2
      );

      if (!isVertical && !isIronCondor) {
        for (const item of resolvedRows) {
          unsupportedBundledRowNumbers.add(item.row.rowNumber);
        }
        continue;
      }

      const actionType = totalAmount <= 0 ? PositionActionType.STO : PositionActionType.BTO;
      const premiumPerUnit = firstQuantity > 0 ? Math.abs(totalAmount) / (firstQuantity * 100) : 0;

      bundlesBySeedRowNumber.set(seedRowNumber, {
        seedRowNumber,
        componentRows: orderedRows,
        quantity: firstQuantity,
        actionType,
        premiumPerUnit,
        feeAmount,
        spreadLegs,
      });

      for (const row of orderedRows.slice(1)) {
        consumedComponentRowNumbers.add(row.rowNumber);
      }
    } catch {
      for (const row of bucket) {
        unsupportedBundledRowNumbers.add(row.rowNumber);
      }
    }
  }

  return {
    bundlesBySeedRowNumber,
    rollsBySeedRowNumber,
    consumedComponentRowNumbers,
    unsupportedBundledRowNumbers,
  };
}

function buildTigerOptionExpiryGroups(rows: TigerNormalizedTradeRow[]) {
  const groupedRows = new Map<string, TigerNormalizedTradeRow[]>();

  for (const row of rows) {
    if (
      row.skipReason !== null ||
      row.assetType !== "POSITION" ||
      row.sourceSection !== "Exercise and Expiration" ||
      row.side.toUpperCase() !== "OPTION EXPIRE" ||
      !row.eventTimestamp
    ) {
      continue;
    }

    const quantity = Math.abs(row.quantity ?? 0);
    const groupKey = `${row.underlyingSymbol}|${row.eventTimestamp}|${quantity}`;
    const bucket = groupedRows.get(groupKey) ?? [];
    bucket.push(row);
    groupedRows.set(groupKey, bucket);
  }

  const bundlesBySeedRowNumber = new Map<number, TigerOptionExpiryBundle>();
  const consumedComponentRowNumbers = new Set<number>();

  for (const bucket of groupedRows.values()) {
    if (bucket.length <= 1) {
      continue;
    }

    const expiredLegs = bucket
      .map((row) => getTigerOptionDetails(row.symbol))
      .filter((leg): leg is NonNullable<typeof leg> => leg !== null)
      .map((leg) => ({
        underlyingSymbol: leg.underlyingSymbol,
        optionType: leg.optionType,
        expiryDate: leg.expiryDate,
        strikePrice: leg.strikePrice,
      }));

    if (expiredLegs.length !== bucket.length) {
      continue;
    }

    const orderedRows = [...bucket].sort((left, right) => left.rowNumber - right.rowNumber);
    const seedRowNumber = orderedRows[0]?.rowNumber;
    if (!seedRowNumber) {
      continue;
    }

    bundlesBySeedRowNumber.set(seedRowNumber, {
      seedRowNumber,
      componentRows: orderedRows,
      quantity: Math.abs(orderedRows[0]?.quantity ?? 0),
      expiredLegs,
    });

    // Tiger exports worthless expiry legs as separate rows in Exercise and Expiration.
    // We collapse the multi-leg expiry into one import action so spreads and ICs do not remain falsely open.
    for (const row of orderedRows.slice(1)) {
      consumedComponentRowNumbers.add(row.rowNumber);
    }
  }

  return {
    bundlesBySeedRowNumber,
    consumedComponentRowNumbers,
  };
}

async function ensureTigerOptionRoll(input: {
  roll: TigerOptionRoll;
  brokerAccountId: string;
  importBatchId: string;
  importCurrency: string;
}) {
  const { roll, brokerAccountId, importBatchId, importCurrency } = input;
  const seedRow = roll.componentRows[0];
  if (!seedRow) {
    throw new Error("Tiger option roll group is empty.");
  }

  const actionTimestamp = toDateOrNow(seedRow.eventTimestamp);
  const importReference = getImportReference(importBatchId, seedRow.rowNumber);
  const rollActionType = roll.netAmount <= 0
    ? PositionActionType.ROLL_CREDIT
    : PositionActionType.ROLL_DEBIT;

  if (roll.closingLegs.length === 1 && roll.openingLegs.length === 1) {
    const closingLeg = roll.closingLegs[0];
    const openingLeg = roll.openingLegs[0];
    if (!closingLeg || !openingLeg) {
      throw new Error("Tiger single-leg roll legs are incomplete.");
    }

    const closingRow = roll.componentRows.find((row) => {
      const details = getTigerOptionDetails(row.symbol);
      return details
        && details.optionType === closingLeg.optionType
        && isSameContractDate(details.expiryDate, closingLeg.expiryDate)
        && details.strikePrice === closingLeg.strikePrice
        && !resolveTigerOptionAction(row).opening;
    }) ?? seedRow;

    const existingPosition = await findMatchingOpenTigerOptionPosition(
      brokerAccountId,
      closingRow,
      closingLeg,
      roll.closingActionType === PositionActionType.BTC ? LegSide.SHORT : LegSide.LONG,
    );

    if (!existingPosition) {
      throw new Error("Cannot apply Tiger option roll: source option position was not found as open.");
    }

    const currentLegQty = Number(existingPosition.leg.quantity.toString());
    if (currentLegQty + 0.0000001 < roll.quantity) {
      throw new Error(`Tiger roll quantity ${roll.quantity} is greater than open option quantity ${currentLegQty}.`);
    }

    await prisma.positionLeg.update({
      where: { id: existingPosition.leg.id },
      data: {
        legStatus: LegStatus.ROLLED,
        closedAt: actionTimestamp,
      },
    });

    const nextStrategyType = await deriveStrategyTypeForNewTigerOptionPosition({
      brokerAccountId,
      underlyingSymbol: seedRow.underlyingSymbol,
      optionDetails: openingLeg,
      actionType: roll.openingActionType,
      actionTimestamp,
    });

    await prisma.positionLeg.create({
      data: {
        positionId: existingPosition.position.id,
        legType: LegType.OPTION,
        legSide: roll.openingActionType === PositionActionType.STO ? LegSide.SHORT : LegSide.LONG,
        optionType: openingLeg.optionType,
        underlyingSymbol: openingLeg.underlyingSymbol,
        expiryDate: openingLeg.expiryDate,
        strikePrice: toDecimalString(openingLeg.strikePrice),
        quantity: toDecimalString(roll.quantity),
        multiplier: "100",
        legRole: inferSingleLegRoleForStrategy({
          strategyType: nextStrategyType,
          legSide: roll.openingActionType === PositionActionType.STO ? LegSide.SHORT : LegSide.LONG,
          optionType: openingLeg.optionType,
        }),
        openedAt: actionTimestamp,
        legStatus: LegStatus.OPEN,
        parentLegId: existingPosition.leg.id,
      },
    });

    await prisma.position.update({
      where: { id: existingPosition.position.id },
      data: {
        currentStatus: PositionStatus.OPEN,
        closedAt: null,
        strategyType: nextStrategyType,
      },
    });

    await prisma.positionAction.create({
      data: {
        positionId: existingPosition.position.id,
        actionTimestamp,
        actionType: rollActionType,
        actionEffect: ActionEffectType.ROLL,
        amount: toDecimalString(roll.premiumPerUnit),
        feeAmount: toDecimalString(roll.feeAmount),
        currency: importCurrency,
        quantity: toDecimalString(roll.quantity),
        premiumPerUnit: toDecimalString(roll.premiumPerUnit),
        resultingStatus: PositionStatus.OPEN,
        notes: `Imported option roll from Tiger (${importReference})`,
        brokerReference: importReference,
      },
    });

    const premiumNotional = Math.abs(roll.premiumPerUnit * roll.quantity * 100);
    const primaryCashAmount = rollActionType === PositionActionType.ROLL_DEBIT ? -premiumNotional : premiumNotional;
    const ledgerEntries: Array<{
      brokerAccountId: string;
      txnTimestamp: Date;
      txnType: CashTxnType;
      amount: string;
      currency: string;
      linkedPositionId?: string;
      description: string;
      externalReference: string;
    }> = [
      {
        brokerAccountId,
        txnTimestamp: actionTimestamp,
        txnType: CashTxnType.OPTIONS_PREMIUM,
        amount: toDecimalString(primaryCashAmount),
        currency: importCurrency,
        linkedPositionId: existingPosition.position.id,
        description: `Imported ${rollActionType} premium for ${seedRow.underlyingSymbol} option roll`,
        externalReference: `${importReference}:POSITION:PRIMARY`,
      },
    ];

    if (roll.feeAmount > 0) {
      ledgerEntries.push({
        brokerAccountId,
        txnTimestamp: actionTimestamp,
        txnType: "COMMISSION" as const,
        amount: toDecimalString(-roll.feeAmount),
        currency: importCurrency,
        linkedPositionId: existingPosition.position.id,
        description: `Imported position fee for ${seedRow.underlyingSymbol} option roll`,
        externalReference: `${importReference}:POSITION:FEE`,
      });
    }

    await prisma.cashLedger.createMany({ data: ledgerEntries });

    return {
      positionCreated: 0,
      positionActionCreated: 1,
      cashLedgerEntriesCreated: ledgerEntries.length,
    };
  }

  const existingSpread = await findMatchingOpenTigerSpreadPosition({
    brokerAccountId,
    underlyingSymbol: seedRow.underlyingSymbol,
    spreadLegs: roll.closingLegs,
  });
  const openingEquivalentActionType = roll.closingActionType === PositionActionType.BTC
    ? PositionActionType.STO
    : PositionActionType.BTO;
  const seededSpread = !existingSpread
    ? await (async () => {
      const seededStrategyType = deriveStrategyTypeForSpreadPosition({
        spreadLegs: roll.closingLegs,
        actionType: openingEquivalentActionType,
      });

      if (seededStrategyType === StrategyType.CUSTOM) {
        throw new Error("Cannot apply Tiger option roll: source spread position was not found as open.");
      }

      const seededPosition = await prisma.position.create({
        data: {
          brokerAccountId,
          sourceType: PositionSourceType.IMPORTED,
          assetClass: AssetClass.OPTION,
          strategyType: seededStrategyType,
          underlyingSymbol: seedRow.underlyingSymbol,
          positionTitle: `${seedRow.underlyingSymbol} historical spread`,
          openedAt: actionTimestamp,
          currentStatus: PositionStatus.OPEN,
          tradeNotes: `Auto-seeded missing Tiger source spread before roll (${importReference})`,
        },
      });

      const seededBlueprints = buildSpreadLegBlueprints({
        spreadLegs: roll.closingLegs,
        strategyType: seededStrategyType,
      });

      await prisma.positionLeg.createMany({
        data: seededBlueprints.map((leg) => ({
          positionId: seededPosition.id,
          legType: LegType.OPTION,
          legSide: leg.legSide,
          optionType: leg.optionType,
          underlyingSymbol: leg.underlyingSymbol,
          expiryDate: leg.expiryDate,
          strikePrice: toDecimalString(leg.strikePrice),
          quantity: toDecimalString(roll.quantity),
          multiplier: "100",
          legRole: leg.legRole,
          openedAt: actionTimestamp,
          legStatus: LegStatus.OPEN,
        })),
      });

      return findMatchingOpenTigerSpreadPosition({
        brokerAccountId,
        underlyingSymbol: seedRow.underlyingSymbol,
        spreadLegs: roll.closingLegs,
      });
    })()
    : null;
  const sourceSpread = existingSpread ?? seededSpread;

  if (!sourceSpread) {
    throw new Error("Cannot apply Tiger option roll: source spread position was not found as open.");
  }

  const matchingOldLegs = sourceSpread.activeOptionLegs.filter((leg) => {
    const contractKey = getTigerPositionLegContractKey({
      optionType: leg.optionType as OptionType | null,
      expiryDate: leg.expiryDate as Date | null,
      strikePrice: leg.strikePrice,
    });

    return contractKey !== null && roll.closingLegs.some((sourceLeg) => getTigerSpreadLegContractKey(sourceLeg) === contractKey);
  });

  if (matchingOldLegs.length !== roll.closingLegs.length) {
    throw new Error("Cannot apply Tiger option roll: source spread legs were not found on the open position.");
  }

  for (const leg of matchingOldLegs) {
    await prisma.positionLeg.update({
      where: { id: leg.id },
      data: {
        legStatus: LegStatus.ROLLED,
        closedAt: actionTimestamp,
      },
    });
  }

  const nextStrategyType = deriveStrategyTypeForSpreadPosition({
    spreadLegs: roll.openingLegs,
    actionType: roll.openingActionType,
  });

  const spreadBlueprints = buildSpreadLegBlueprints({
    spreadLegs: roll.openingLegs,
    strategyType: nextStrategyType,
  });

  for (const leg of spreadBlueprints) {
    const parentLeg = matchingOldLegs.find((candidate) => (
      candidate.legSide === leg.legSide &&
      candidate.optionType === leg.optionType
    )) ?? matchingOldLegs.find((candidate) => candidate.legRole === leg.legRole) ?? null;

    await prisma.positionLeg.create({
      data: {
        positionId: sourceSpread.position.id,
        legType: LegType.OPTION,
        legSide: leg.legSide,
        optionType: leg.optionType,
        underlyingSymbol: leg.underlyingSymbol,
        expiryDate: leg.expiryDate,
        strikePrice: toDecimalString(leg.strikePrice),
        quantity: toDecimalString(roll.quantity),
        multiplier: "100",
        legRole: parentLeg?.legRole ?? leg.legRole,
        openedAt: actionTimestamp,
        legStatus: LegStatus.OPEN,
        parentLegId: parentLeg?.id ?? null,
      },
    });
  }

  await prisma.position.update({
    where: { id: sourceSpread.position.id },
    data: {
      currentStatus: PositionStatus.OPEN,
      closedAt: null,
      strategyType: nextStrategyType,
    },
  });

  await prisma.positionAction.create({
    data: {
      positionId: sourceSpread.position.id,
      actionTimestamp,
      actionType: rollActionType,
      actionEffect: ActionEffectType.ROLL,
      amount: toDecimalString(roll.premiumPerUnit),
      feeAmount: toDecimalString(roll.feeAmount),
      currency: importCurrency,
      quantity: toDecimalString(roll.quantity),
      premiumPerUnit: toDecimalString(roll.premiumPerUnit),
      resultingStatus: PositionStatus.OPEN,
      notes: `Imported option bundle roll from Tiger (${importReference})`,
      brokerReference: importReference,
    },
  });

  const premiumNotional = Math.abs(roll.premiumPerUnit * roll.quantity * 100);
  const primaryCashAmount = rollActionType === PositionActionType.ROLL_DEBIT ? -premiumNotional : premiumNotional;
  const ledgerEntries: Array<{
    brokerAccountId: string;
    txnTimestamp: Date;
    txnType: CashTxnType;
    amount: string;
    currency: string;
    linkedPositionId?: string;
    description: string;
    externalReference: string;
  }> = [
      {
        brokerAccountId,
        txnTimestamp: actionTimestamp,
        txnType: CashTxnType.OPTIONS_PREMIUM,
        amount: toDecimalString(primaryCashAmount),
        currency: importCurrency,
        linkedPositionId: sourceSpread.position.id,
        description: `Imported ${rollActionType} premium for ${seedRow.underlyingSymbol} option bundle roll`,
        externalReference: `${importReference}:POSITION:PRIMARY`,
      },
    ];

  if (roll.feeAmount > 0) {
    ledgerEntries.push({
        brokerAccountId,
        txnTimestamp: actionTimestamp,
        txnType: "COMMISSION" as const,
        amount: toDecimalString(-roll.feeAmount),
        currency: importCurrency,
        linkedPositionId: sourceSpread.position.id,
        description: `Imported position fee for ${seedRow.underlyingSymbol} option bundle roll`,
        externalReference: `${importReference}:POSITION:FEE`,
      });
  }

  await prisma.cashLedger.createMany({ data: ledgerEntries });

  return {
    positionCreated: seededSpread ? 1 : 0,
    positionActionCreated: 1,
    cashLedgerEntriesCreated: ledgerEntries.length,
  };
}

function resolveTigerOptionAction(row: TigerNormalizedTradeRow) {
  const side = row.side.toUpperCase();
  const quantity = row.quantity ?? 0;
  const amount = row.amount ?? 0;

  if (side === "OPENSHORT" && quantity < 0 && amount <= 0) {
    return {
      actionType: PositionActionType.STO,
      legSide: LegSide.SHORT,
      quantity: Math.abs(quantity),
      opening: true,
    };
  }

  if (side === "OPEN" && quantity > 0 && amount >= 0) {
    return {
      actionType: PositionActionType.BTO,
      legSide: LegSide.LONG,
      quantity: Math.abs(quantity),
      opening: true,
    };
  }

  if (side === "CLOSE" && quantity > 0 && amount >= 0) {
    return {
      actionType: PositionActionType.BTC,
      legSide: LegSide.SHORT,
      quantity: Math.abs(quantity),
      opening: false,
    };
  }

  if (side === "CLOSE" && quantity < 0 && amount <= 0) {
    return {
      actionType: PositionActionType.STC,
      legSide: LegSide.LONG,
      quantity: Math.abs(quantity),
      opening: false,
    };
  }

  throw new Error(`Tiger option activity is not supported yet: ${row.side} (${row.quantity ?? "N/A"} qty).`);
}

function resolveTigerExpiredLegSide(row: TigerNormalizedTradeRow) {
  const quantity = row.quantity ?? 0;

  if (row.side.toUpperCase() !== "OPTION EXPIRE" || quantity === 0) {
    throw new Error(`Tiger option expiry activity is not supported yet: ${row.side} (${row.quantity ?? "N/A"} qty).`);
  }

  // Tiger's Exercise and Expiration rows use the opposite sign convention from normal option trade rows:
  // positive quantity marks an expired short leg, while negative quantity marks an expired long leg.
  return quantity > 0 ? LegSide.SHORT : LegSide.LONG;
}

function resolveTigerHoldingDirection(row: TigerNormalizedTradeRow) {
  const quantity = row.quantity ?? 0;
  const amount = row.amount ?? 0;
  const side = row.side.toUpperCase();

  if (side === "OPEN" && quantity > 0 && amount >= 0) {
    return {
      isBuy: true,
      quantity: Math.abs(quantity),
      amount: Math.abs(amount),
    };
  }

  if (side === "CLOSE" && quantity < 0 && amount <= 0) {
    return {
      isBuy: false,
      quantity: Math.abs(quantity),
      amount: Math.abs(amount),
    };
  }

  throw new Error(`Tiger stock activity is not supported yet: ${row.side} (${row.quantity ?? "N/A"} qty).`);
}

async function ensureTigerHoldingForRow(
  row: TigerNormalizedTradeRow,
  brokerAccountId: string,
  importBatchId: string,
  importCurrency: string,
) {
  const direction = resolveTigerHoldingDirection(row);
  const quantity = direction.quantity;
  const amount = direction.amount;
  const pricePerShare = Math.abs(row.price ?? 0);
  const feeAmount = Math.abs(row.feeAmount ?? 0);
  const eventTimestamp = toDateOrNow(row.eventTimestamp);
  const isBuy = direction.isBuy;
  const isSell = !direction.isBuy;

  if (quantity <= 0 || pricePerShare < 0) {
    throw new Error("Tiger holding row has invalid quantity or price.");
  }

  const findActiveHolding = async (mode: "buy" | "sell") => prisma.holding.findFirst({
    where: {
      brokerAccountId,
      symbol: row.underlyingSymbol,
      remainingQuantity: {
        gt: "0",
      },
      holdingStatus: {
        in: [HoldingStatus.OPEN, HoldingStatus.PARTIALLY_SOLD],
      },
    },
    orderBy: mode === "sell"
      ? [{ openedAt: "asc" }, { createdAt: "asc" }]
      : [{ openedAt: "desc" }, { createdAt: "desc" }],
  });

  let holding = await findActiveHolding(isSell ? "sell" : "buy");

  const importReference = getImportReference(importBatchId, row.rowNumber);
  let holdingCreatedCount = 0;
  let syntheticOpeningEventsCreated = 0;

  if (!holding && !isBuy) {
    holding = await prisma.holding.create({
      data: {
        brokerAccountId,
        sourceType: HoldingSourceType.TRANSFER_IN,
        symbol: row.underlyingSymbol,
        quantity: toDecimalString(quantity),
        openQuantity: toDecimalString(quantity),
        remainingQuantity: toDecimalString(quantity),
        costBasisPerShare: toDecimalString(pricePerShare),
        openedAt: eventTimestamp,
        holdingStatus: HoldingStatus.OPEN,
        notes: `Imported from Tiger (${importReference}) - auto-seeded opening inventory`,
      },
    });
    holdingCreatedCount = 1;

    await prisma.holdingEvent.create({
      data: {
        holdingId: holding.id,
        eventTimestamp,
        eventType: HoldingEventType.TRANSFER_IN,
        quantity: toDecimalString(quantity),
        pricePerShare: toDecimalString(pricePerShare),
        amount: toDecimalString(quantity * pricePerShare),
        feeAmount: "0",
        currency: importCurrency,
        notes: `Auto-seeded opening inventory for Tiger import (${importReference})`,
      },
    });
    syntheticOpeningEventsCreated += 1;
  }

  if (!holding && isBuy) {
    const initialCostBasisPerShare = quantity > 0
      ? (Math.abs(amount) + feeAmount) / quantity
      : pricePerShare;

    holding = await prisma.holding.create({
      data: {
        brokerAccountId,
        sourceType: HoldingSourceType.MANUAL_BUY,
        symbol: row.underlyingSymbol,
        quantity: toDecimalString(quantity),
        openQuantity: toDecimalString(quantity),
        remainingQuantity: toDecimalString(quantity),
        costBasisPerShare: toDecimalString(initialCostBasisPerShare),
        openedAt: eventTimestamp,
        holdingStatus: HoldingStatus.OPEN,
        notes: `Imported from Tiger (${importReference})`,
      },
    });
    holdingCreatedCount = 1;
  }

  if (!holding) {
    throw new Error("Failed to initialize Tiger holding for import.");
  }

  let currentRemaining = Number(holding.remainingQuantity.toString());
  let currentOpenQuantity = Number(holding.openQuantity.toString());
  let currentCostBasisPerShare = Number(holding.costBasisPerShare.toString());
  let currentCostPool = currentRemaining * currentCostBasisPerShare;

  let nextRemaining = currentRemaining;
  let nextOpenQuantity = currentOpenQuantity;
  let nextCostBasisPerShare = currentCostBasisPerShare;
  let eventType: HoldingEventType = HoldingEventType.ACQUIRED;
  const isFirstImportedBuyForNewHolding = holdingCreatedCount === 1 && isBuy;

  if (isBuy && !isFirstImportedBuyForNewHolding) {
    nextRemaining = currentRemaining + quantity;
    nextOpenQuantity = currentOpenQuantity + quantity;
    const incomingCost = amount + feeAmount;
    nextCostBasisPerShare = nextRemaining > 0
      ? (currentCostPool + incomingCost) / nextRemaining
      : currentCostBasisPerShare;
    eventType = HoldingEventType.ACQUIRED;
  } else if (isFirstImportedBuyForNewHolding) {
    eventType = HoldingEventType.ACQUIRED;
  } else if (isSell) {
    if (quantity > currentRemaining + 0.0000001) {
      const deficit = quantity - currentRemaining;
      const deficitAmount = deficit * pricePerShare;
      const adjustedOpenQuantity = currentOpenQuantity + deficit;
      const adjustedRemaining = currentRemaining + deficit;
      const adjustedCostPool = currentCostPool + deficitAmount;
      const adjustedCostBasis = adjustedRemaining > 0
        ? adjustedCostPool / adjustedRemaining
        : currentCostBasisPerShare;

      await prisma.holdingEvent.create({
        data: {
          holdingId: holding.id,
          eventTimestamp,
          eventType: HoldingEventType.TRANSFER_IN,
          quantity: toDecimalString(deficit),
          pricePerShare: toDecimalString(pricePerShare),
          amount: toDecimalString(deficitAmount),
          feeAmount: "0",
          currency: importCurrency,
          notes: `Auto-seeded missing opening quantity for Tiger import (${importReference})`,
        },
      });

      await prisma.holding.update({
        where: { id: holding.id },
        data: {
          quantity: toDecimalString(adjustedOpenQuantity),
          openQuantity: toDecimalString(adjustedOpenQuantity),
          remainingQuantity: toDecimalString(adjustedRemaining),
          costBasisPerShare: toDecimalString(adjustedCostBasis),
          holdingStatus: HoldingStatus.OPEN,
          closedAt: null,
        },
      });

      currentOpenQuantity = adjustedOpenQuantity;
      currentRemaining = adjustedRemaining;
      currentCostPool = adjustedCostPool;
      currentCostBasisPerShare = adjustedCostBasis;
      syntheticOpeningEventsCreated += 1;
    }
    nextRemaining = Math.max(currentRemaining - quantity, 0);
    eventType = nextRemaining > 0 ? HoldingEventType.PARTIAL_SELL : HoldingEventType.SOLD;
  } else {
    throw new Error(`Unsupported Tiger holding side: ${row.side}`);
  }

  const nextStatus = nextRemaining <= 0
    ? HoldingStatus.CLOSED
    : nextRemaining < nextOpenQuantity
      ? HoldingStatus.PARTIALLY_SOLD
      : HoldingStatus.OPEN;

  await prisma.holding.update({
    where: { id: holding.id },
    data: {
      quantity: toDecimalString(nextOpenQuantity),
      openQuantity: toDecimalString(nextOpenQuantity),
      remainingQuantity: toDecimalString(nextRemaining),
      costBasisPerShare: toDecimalString(nextCostBasisPerShare),
      holdingStatus: nextStatus,
      closedAt: nextRemaining <= 0 ? eventTimestamp : null,
    },
  });

  await prisma.holdingEvent.create({
    data: {
      holdingId: holding.id,
      eventTimestamp,
      eventType,
      quantity: toDecimalString(quantity),
      pricePerShare: toDecimalString(pricePerShare),
      amount: toDecimalString(amount),
      feeAmount: toDecimalString(feeAmount),
      currency: importCurrency,
      notes: `Imported from Tiger (${importReference})`,
    },
  });

  const ledgerEntries: Array<{
    brokerAccountId: string;
    txnTimestamp: Date;
    txnType: CashTxnType;
    amount: string;
    currency: string;
    linkedHoldingId?: string;
    description: string;
    externalReference: string;
  }> = [];

  if (eventType === HoldingEventType.ACQUIRED) {
    ledgerEntries.push({
      brokerAccountId,
      txnTimestamp: eventTimestamp,
      txnType: STOCK_PURCHASE_TXN_TYPE,
      amount: toDecimalString(-amount),
      currency: importCurrency,
      linkedHoldingId: holding.id,
      description: `Imported ${eventType} for ${holding.symbol}`,
      externalReference: `${importReference}:HOLDING:PRIMARY`,
    });
  } else {
    ledgerEntries.push({
      brokerAccountId,
      txnTimestamp: eventTimestamp,
      txnType: STOCK_SALE_TXN_TYPE,
      amount: toDecimalString(amount),
      currency: importCurrency,
      linkedHoldingId: holding.id,
      description: `Imported ${eventType} for ${holding.symbol}`,
      externalReference: `${importReference}:HOLDING:PRIMARY`,
    });
  }

  if (feeAmount > 0) {
    ledgerEntries.push({
      brokerAccountId,
      txnTimestamp: eventTimestamp,
      txnType: "COMMISSION" as const,
      amount: toDecimalString(-feeAmount),
      currency: importCurrency,
      linkedHoldingId: holding.id,
      description: `Imported holding fee for ${holding.symbol}`,
      externalReference: `${importReference}:HOLDING:FEE`,
    });
  }

  if (ledgerEntries.length > 0) {
    await prisma.cashLedger.createMany({ data: ledgerEntries });
  }

  return {
    holdingCreated: holdingCreatedCount,
    holdingEventCreated: 1 + syntheticOpeningEventsCreated,
    cashLedgerEntriesCreated: ledgerEntries.length,
  };
}

async function ensureTigerSingleOptionForRow(
  row: TigerNormalizedTradeRow,
  brokerAccountId: string,
  importBatchId: string,
  importCurrency: string,
) {
  const optionDetails = getTigerOptionDetails(row.symbol);
  if (!optionDetails) {
    throw new Error("Tiger option contract could not be parsed.");
  }

  const actionTimestamp = toDateOrNow(row.eventTimestamp);
  const premiumPerUnit = Math.abs(row.price ?? 0);
  const feeAmount = Math.abs(row.feeAmount ?? 0);
  const importReference = getImportReference(importBatchId, row.rowNumber);
  const resolvedAction = resolveTigerOptionAction(row);
  const quantity = resolvedAction.quantity;

  if (quantity <= 0 || premiumPerUnit < 0) {
    throw new Error("Tiger option row has invalid quantity or price.");
  }

  if (resolvedAction.actionType === PositionActionType.BTC) {
    const existingShort = await findMatchingOpenTigerOptionPosition(
      brokerAccountId,
      row,
      optionDetails,
      LegSide.SHORT,
    );

    if (!existingShort) {
      throw new Error("Cannot match Tiger BTC row to an open short option position.");
    }

    const currentLegQty = Number(existingShort.leg.quantity.toString());
    if (currentLegQty + 0.0000001 < quantity) {
      throw new Error(`Tiger BTC quantity ${quantity} is greater than open short quantity ${currentLegQty}.`);
    }

    const remainingQty = Math.max(currentLegQty - quantity, 0);
    await prisma.positionLeg.update({
      where: { id: existingShort.leg.id },
      data: remainingQty > 0
        ? {
          quantity: toDecimalString(remainingQty),
          legStatus: LegStatus.PARTIALLY_CLOSED,
        }
        : {
          legStatus: LegStatus.CLOSED,
          closedAt: actionTimestamp,
        },
    });

    const nextPositionStatus = await derivePositionStatusFromLegs(existingShort.position.id);

    await prisma.position.update({
      where: { id: existingShort.position.id },
      data: {
        currentStatus: nextPositionStatus,
        closedAt: remainingQty <= 0 ? actionTimestamp : null,
      },
    });

    await prisma.positionAction.create({
      data: {
        positionId: existingShort.position.id,
        actionTimestamp,
        actionType: PositionActionType.BTC,
        actionEffect: nextPositionStatus === PositionStatus.CLOSED ? ActionEffectType.CLOSE : ActionEffectType.REDUCE,
        amount: toDecimalString(premiumPerUnit),
        feeAmount: toDecimalString(feeAmount),
        currency: importCurrency,
        quantity: toDecimalString(quantity),
        premiumPerUnit: toDecimalString(premiumPerUnit),
        resultingStatus: nextPositionStatus,
        notes: `Imported from Tiger (${importReference})`,
        brokerReference: importReference,
      },
    });

    const premiumNotional = Math.abs(premiumPerUnit * quantity * 100);
    const ledgerEntries: Array<{
      brokerAccountId: string;
      txnTimestamp: Date;
      txnType: CashTxnType;
      amount: string;
      currency: string;
      linkedPositionId?: string;
      description: string;
      externalReference: string;
    }> = [
      {
        brokerAccountId,
        txnTimestamp: actionTimestamp,
        txnType: CashTxnType.OPTIONS_PREMIUM,
        amount: toDecimalString(-premiumNotional),
        currency: importCurrency,
        linkedPositionId: existingShort.position.id,
        description: `Imported BTC premium for ${row.symbol}`,
        externalReference: `${importReference}:POSITION:PRIMARY`,
      },
    ];

    if (feeAmount > 0) {
      ledgerEntries.push({
        brokerAccountId,
        txnTimestamp: actionTimestamp,
        txnType: "COMMISSION",
        amount: toDecimalString(-feeAmount),
        currency: importCurrency,
        linkedPositionId: existingShort.position.id,
        description: `Imported position fee for ${row.symbol}`,
        externalReference: `${importReference}:POSITION:FEE`,
      });
    }

    await prisma.cashLedger.createMany({ data: ledgerEntries });

    return {
      positionCreated: 0,
      positionActionCreated: 1,
      cashLedgerEntriesCreated: ledgerEntries.length,
    };
  }

  if (resolvedAction.actionType === PositionActionType.STC) {
    const existingLong = await findMatchingOpenTigerOptionPosition(
      brokerAccountId,
      row,
      optionDetails,
      LegSide.LONG,
    );

    if (!existingLong) {
      throw new Error("Cannot match Tiger STC row to an open long option position.");
    }

    const currentLegQty = Number(existingLong.leg.quantity.toString());
    if (currentLegQty + 0.0000001 < quantity) {
      throw new Error(`Tiger STC quantity ${quantity} is greater than open long quantity ${currentLegQty}.`);
    }

    const remainingQty = Math.max(currentLegQty - quantity, 0);
    await prisma.positionLeg.update({
      where: { id: existingLong.leg.id },
      data: remainingQty > 0
        ? {
          quantity: toDecimalString(remainingQty),
          legStatus: LegStatus.PARTIALLY_CLOSED,
        }
        : {
          legStatus: LegStatus.CLOSED,
          closedAt: actionTimestamp,
        },
    });

    const nextPositionStatus = await derivePositionStatusFromLegs(existingLong.position.id);

    await prisma.position.update({
      where: { id: existingLong.position.id },
      data: {
        currentStatus: nextPositionStatus,
        closedAt: remainingQty <= 0 ? actionTimestamp : null,
      },
    });

    await prisma.positionAction.create({
      data: {
        positionId: existingLong.position.id,
        actionTimestamp,
        actionType: PositionActionType.STC,
        actionEffect: nextPositionStatus === PositionStatus.CLOSED ? ActionEffectType.CLOSE : ActionEffectType.REDUCE,
        amount: toDecimalString(premiumPerUnit),
        feeAmount: toDecimalString(feeAmount),
        currency: importCurrency,
        quantity: toDecimalString(quantity),
        premiumPerUnit: toDecimalString(premiumPerUnit),
        resultingStatus: nextPositionStatus,
        notes: `Imported from Tiger (${importReference})`,
        brokerReference: importReference,
      },
    });

    const premiumNotional = Math.abs(premiumPerUnit * quantity * 100);
    const ledgerEntries: Array<{
      brokerAccountId: string;
      txnTimestamp: Date;
      txnType: CashTxnType;
      amount: string;
      currency: string;
      linkedPositionId?: string;
      description: string;
      externalReference: string;
    }> = [
      {
        brokerAccountId,
        txnTimestamp: actionTimestamp,
        txnType: CashTxnType.OPTIONS_PREMIUM,
        amount: toDecimalString(premiumNotional),
        currency: importCurrency,
        linkedPositionId: existingLong.position.id,
        description: `Imported STC premium for ${row.symbol}`,
        externalReference: `${importReference}:POSITION:PRIMARY`,
      },
    ];

    if (feeAmount > 0) {
      ledgerEntries.push({
        brokerAccountId,
        txnTimestamp: actionTimestamp,
        txnType: "COMMISSION",
        amount: toDecimalString(-feeAmount),
        currency: importCurrency,
        linkedPositionId: existingLong.position.id,
        description: `Imported position fee for ${row.symbol}`,
        externalReference: `${importReference}:POSITION:FEE`,
      });
    }

    await prisma.cashLedger.createMany({ data: ledgerEntries });

    return {
      positionCreated: 0,
      positionActionCreated: 1,
      cashLedgerEntriesCreated: ledgerEntries.length,
    };
  }

  const linkedCoveredCallHolding = (
    resolvedAction.actionType === PositionActionType.STO &&
    optionDetails.optionType === OptionType.CALL
  )
    ? await findCoveredCallHolding({
      brokerAccountId,
      underlyingSymbol: row.underlyingSymbol,
      requiredShares: quantity * 100,
    })
    : null;

  const derivedStrategyType = await deriveStrategyTypeForNewTigerOptionPosition({
    brokerAccountId,
    underlyingSymbol: row.underlyingSymbol,
    optionDetails,
    actionType: resolvedAction.actionType,
    actionTimestamp,
  });

  const position = await prisma.position.create({
    data: {
      brokerAccountId,
      sourceType: PositionSourceType.IMPORTED,
      assetClass: AssetClass.OPTION,
      strategyType: derivedStrategyType,
      underlyingSymbol: row.underlyingSymbol,
      linkedHoldingId: linkedCoveredCallHolding?.id ?? null,
      positionTitle: row.name || row.symbol,
      openedAt: actionTimestamp,
      currentStatus: PositionStatus.OPEN,
      tradeNotes: `Imported from Tiger (${importReference})`,
    },
  });

  const inferredSingleLegRole = inferSingleLegRoleForStrategy({
    strategyType: derivedStrategyType,
    legSide: resolvedAction.legSide,
    optionType: optionDetails.optionType,
  });

  await prisma.positionLeg.create({
    data: {
      positionId: position.id,
      legType: LegType.OPTION,
      legSide: resolvedAction.legSide,
      optionType: optionDetails.optionType,
      underlyingSymbol: row.underlyingSymbol,
      expiryDate: optionDetails.expiryDate,
      strikePrice: toDecimalString(optionDetails.strikePrice),
      quantity: toDecimalString(quantity),
      multiplier: "100",
      legRole: inferredSingleLegRole,
      openedAt: actionTimestamp,
      legStatus: LegStatus.OPEN,
    },
  });

  await prisma.positionAction.create({
    data: {
      positionId: position.id,
      actionTimestamp,
      actionType: resolvedAction.actionType,
      actionEffect: ActionEffectType.OPEN,
      amount: toDecimalString(premiumPerUnit),
      feeAmount: toDecimalString(feeAmount),
      currency: importCurrency,
      quantity: toDecimalString(quantity),
      premiumPerUnit: toDecimalString(premiumPerUnit),
      resultingStatus: PositionStatus.OPEN,
      notes: `Imported from Tiger (${importReference})`,
      brokerReference: importReference,
    },
  });

  const premiumNotional = Math.abs(premiumPerUnit * quantity * 100);
  const primaryCashAmount = resolvedAction.actionType === PositionActionType.STO ? premiumNotional : -premiumNotional;

  const ledgerEntries: Array<{
    brokerAccountId: string;
    txnTimestamp: Date;
    txnType: CashTxnType;
    amount: string;
    currency: string;
    linkedPositionId?: string;
    description: string;
    externalReference: string;
  }> = [
    {
      brokerAccountId,
      txnTimestamp: actionTimestamp,
      txnType: CashTxnType.OPTIONS_PREMIUM,
      amount: toDecimalString(primaryCashAmount),
      currency: importCurrency,
      linkedPositionId: position.id,
      description: `Imported ${resolvedAction.actionType} premium for ${row.symbol}`,
      externalReference: `${importReference}:POSITION:PRIMARY`,
    },
  ];

  if (feeAmount > 0) {
    ledgerEntries.push({
      brokerAccountId,
      txnTimestamp: actionTimestamp,
      txnType: "COMMISSION",
      amount: toDecimalString(-feeAmount),
      currency: importCurrency,
      linkedPositionId: position.id,
      description: `Imported position fee for ${row.symbol}`,
      externalReference: `${importReference}:POSITION:FEE`,
    });
  }

  await prisma.cashLedger.createMany({ data: ledgerEntries });

  return {
    positionCreated: 1,
    positionActionCreated: 1,
    cashLedgerEntriesCreated: ledgerEntries.length,
  };
}

async function ensureTigerOptionBundle(input: {
  bundle: TigerOptionBundle;
  brokerAccountId: string;
  importBatchId: string;
  importCurrency: string;
}) {
  const { bundle, brokerAccountId, importBatchId, importCurrency } = input;
  const seedRow = bundle.componentRows[0];
  if (!seedRow) {
    throw new Error("Tiger option bundle is empty.");
  }

  const actionTimestamp = toDateOrNow(seedRow.eventTimestamp);
  const importReference = getImportReference(importBatchId, seedRow.rowNumber);
  const existingSpread = await findMatchingOpenTigerSpreadPosition({
    brokerAccountId,
    underlyingSymbol: seedRow.underlyingSymbol,
    spreadLegs: bundle.spreadLegs,
  });

  if (existingSpread) {
    const openedBySto = existingSpread.position.actions.some((action) => action.actionType === PositionActionType.STO);
    const openedByBto = existingSpread.position.actions.some((action) => action.actionType === PositionActionType.BTO);

    if (
      (bundle.actionType === PositionActionType.STO && openedBySto) ||
      (bundle.actionType === PositionActionType.BTO && openedByBto)
    ) {
      const currentSpreadQty = Number(existingSpread.activeOptionLegs[0]?.quantity?.toString() ?? "0");
      const nextQty = currentSpreadQty + bundle.quantity;

      for (const leg of existingSpread.activeOptionLegs) {
        await prisma.positionLeg.update({
          where: { id: leg.id },
          data: {
            quantity: toDecimalString(nextQty),
            legStatus: LegStatus.OPEN,
            closedAt: null,
          },
        });
      }

      await prisma.position.update({
        where: { id: existingSpread.position.id },
        data: {
          currentStatus: PositionStatus.OPEN,
          closedAt: null,
        },
      });

      await prisma.positionAction.create({
        data: {
          positionId: existingSpread.position.id,
          actionTimestamp,
          actionType: bundle.actionType,
          actionEffect: ActionEffectType.INCREASE,
          amount: toDecimalString(bundle.premiumPerUnit),
          feeAmount: toDecimalString(bundle.feeAmount),
          currency: importCurrency,
          quantity: toDecimalString(bundle.quantity),
          premiumPerUnit: toDecimalString(bundle.premiumPerUnit),
          resultingStatus: PositionStatus.OPEN,
          notes: `Imported option bundle quantity increase from Tiger (${importReference})`,
          brokerReference: importReference,
        },
      });

      const premiumNotional = Math.abs(bundle.premiumPerUnit * bundle.quantity * 100);
      const primaryCashAmount = bundle.actionType === PositionActionType.STO ? premiumNotional : -premiumNotional;
      const ledgerEntries: Array<{
        brokerAccountId: string;
        txnTimestamp: Date;
        txnType: CashTxnType;
        amount: string;
        currency: string;
        linkedPositionId?: string;
        description: string;
        externalReference: string;
      }> = [
        {
          brokerAccountId,
          txnTimestamp: actionTimestamp,
          txnType: CashTxnType.OPTIONS_PREMIUM,
          amount: toDecimalString(primaryCashAmount),
          currency: importCurrency,
          linkedPositionId: existingSpread.position.id,
          description: `Imported ${bundle.actionType} premium for ${seedRow.underlyingSymbol} option bundle`,
          externalReference: `${importReference}:POSITION:PRIMARY`,
        },
      ];

      if (bundle.feeAmount > 0) {
        ledgerEntries.push({
          brokerAccountId,
          txnTimestamp: actionTimestamp,
          txnType: "COMMISSION" as const,
          amount: toDecimalString(-bundle.feeAmount),
          currency: importCurrency,
          linkedPositionId: existingSpread.position.id,
          description: `Imported position fee for ${seedRow.underlyingSymbol} option bundle`,
          externalReference: `${importReference}:POSITION:FEE`,
        });
      }

      await prisma.cashLedger.createMany({ data: ledgerEntries });

      return {
        positionCreated: 0,
        positionActionCreated: 1,
        cashLedgerEntriesCreated: ledgerEntries.length,
      };
    }

    const closeActionType = openedBySto ? PositionActionType.BTC : PositionActionType.STC;
    const currentSpreadQty = Number(existingSpread.activeOptionLegs[0]?.quantity?.toString() ?? "0");
    if (currentSpreadQty + 0.0000001 < bundle.quantity) {
      throw new Error(`Tiger bundle close quantity ${bundle.quantity} is greater than open spread quantity ${currentSpreadQty}.`);
    }

    const remainingQty = Math.max(currentSpreadQty - bundle.quantity, 0);

    for (const leg of existingSpread.activeOptionLegs) {
      await prisma.positionLeg.update({
        where: { id: leg.id },
        data: remainingQty > 0
          ? {
            quantity: toDecimalString(remainingQty),
            legStatus: LegStatus.PARTIALLY_CLOSED,
          }
          : {
            legStatus: LegStatus.CLOSED,
            closedAt: actionTimestamp,
          },
      });
    }

    const nextStatus = remainingQty > 0 ? PositionStatus.PARTIALLY_CLOSED : PositionStatus.CLOSED;
    await prisma.position.update({
      where: { id: existingSpread.position.id },
      data: {
        currentStatus: nextStatus,
        closedAt: remainingQty <= 0 ? actionTimestamp : null,
      },
    });

    await prisma.positionAction.create({
      data: {
        positionId: existingSpread.position.id,
        actionTimestamp,
        actionType: closeActionType,
        actionEffect: remainingQty > 0 ? ActionEffectType.REDUCE : ActionEffectType.CLOSE,
        amount: toDecimalString(bundle.premiumPerUnit),
        feeAmount: toDecimalString(bundle.feeAmount),
        currency: importCurrency,
        quantity: toDecimalString(bundle.quantity),
        premiumPerUnit: toDecimalString(bundle.premiumPerUnit),
        resultingStatus: nextStatus,
        notes: `Imported option bundle close from Tiger (${importReference})`,
        brokerReference: importReference,
      },
    });

    const premiumNotional = Math.abs(bundle.premiumPerUnit * bundle.quantity * 100);
    const primaryCashAmount = closeActionType === PositionActionType.BTC ? -premiumNotional : premiumNotional;
    const ledgerEntries: Array<{
      brokerAccountId: string;
      txnTimestamp: Date;
      txnType: CashTxnType;
      amount: string;
      currency: string;
      linkedPositionId?: string;
      description: string;
      externalReference: string;
    }> = [
      {
        brokerAccountId,
        txnTimestamp: actionTimestamp,
        txnType: CashTxnType.OPTIONS_PREMIUM,
        amount: toDecimalString(primaryCashAmount),
        currency: importCurrency,
        linkedPositionId: existingSpread.position.id,
        description: `Imported ${closeActionType} premium for ${seedRow.underlyingSymbol} option bundle`,
        externalReference: `${importReference}:POSITION:PRIMARY`,
      },
    ];

    if (bundle.feeAmount > 0) {
      ledgerEntries.push({
        brokerAccountId,
        txnTimestamp: actionTimestamp,
        txnType: "COMMISSION" as const,
        amount: toDecimalString(-bundle.feeAmount),
        currency: importCurrency,
        linkedPositionId: existingSpread.position.id,
        description: `Imported position fee for ${seedRow.underlyingSymbol} option bundle`,
        externalReference: `${importReference}:POSITION:FEE`,
      });
    }

    await prisma.cashLedger.createMany({ data: ledgerEntries });

    return {
      positionCreated: 0,
      positionActionCreated: 1,
      cashLedgerEntriesCreated: ledgerEntries.length,
    };
  }

  const strategyType = deriveStrategyTypeForSpreadPosition({
    spreadLegs: bundle.spreadLegs,
    actionType: bundle.actionType,
  });
  if (strategyType === StrategyType.CUSTOM) {
    throw new Error("Tiger option bundle structure is not supported yet.");
  }

  const position = await prisma.position.create({
    data: {
      brokerAccountId,
      sourceType: PositionSourceType.IMPORTED,
      assetClass: AssetClass.OPTION,
      strategyType,
      underlyingSymbol: seedRow.underlyingSymbol,
      positionTitle: seedRow.name || seedRow.symbol,
      openedAt: actionTimestamp,
      currentStatus: PositionStatus.OPEN,
      tradeNotes: `Imported option bundle from Tiger (${importReference})`,
    },
  });

  const spreadBlueprints = buildSpreadLegBlueprints({
    spreadLegs: bundle.spreadLegs,
    strategyType,
  });

  await prisma.positionLeg.createMany({
    data: spreadBlueprints.map((leg) => ({
      positionId: position.id,
      legType: LegType.OPTION,
      legSide: leg.legSide,
      optionType: leg.optionType,
      underlyingSymbol: leg.underlyingSymbol,
      expiryDate: leg.expiryDate,
      strikePrice: toDecimalString(leg.strikePrice),
      quantity: toDecimalString(bundle.quantity),
      multiplier: "100",
      legRole: leg.legRole,
      openedAt: actionTimestamp,
      legStatus: LegStatus.OPEN,
    })),
  });

  await prisma.positionAction.create({
    data: {
      positionId: position.id,
      actionTimestamp,
      actionType: bundle.actionType,
      actionEffect: ActionEffectType.OPEN,
      amount: toDecimalString(bundle.premiumPerUnit),
      feeAmount: toDecimalString(bundle.feeAmount),
      currency: importCurrency,
      quantity: toDecimalString(bundle.quantity),
      premiumPerUnit: toDecimalString(bundle.premiumPerUnit),
      resultingStatus: PositionStatus.OPEN,
      notes: `Imported option bundle from Tiger (${importReference})`,
      brokerReference: importReference,
    },
  });

  const premiumNotional = Math.abs(bundle.premiumPerUnit * bundle.quantity * 100);
  const primaryCashAmount = bundle.actionType === PositionActionType.STO ? premiumNotional : -premiumNotional;
  const ledgerEntries: Array<{
    brokerAccountId: string;
    txnTimestamp: Date;
    txnType: CashTxnType;
    amount: string;
    currency: string;
    linkedPositionId?: string;
    description: string;
    externalReference: string;
  }> = [
    {
      brokerAccountId,
      txnTimestamp: actionTimestamp,
      txnType: CashTxnType.OPTIONS_PREMIUM,
      amount: toDecimalString(primaryCashAmount),
      currency: importCurrency,
      linkedPositionId: position.id,
      description: `Imported ${bundle.actionType} premium for ${seedRow.underlyingSymbol} option bundle`,
      externalReference: `${importReference}:POSITION:PRIMARY`,
    },
  ];

  if (bundle.feeAmount > 0) {
    ledgerEntries.push({
      brokerAccountId,
      txnTimestamp: actionTimestamp,
      txnType: "COMMISSION" as const,
      amount: toDecimalString(-bundle.feeAmount),
      currency: importCurrency,
      linkedPositionId: position.id,
      description: `Imported position fee for ${seedRow.underlyingSymbol} option bundle`,
      externalReference: `${importReference}:POSITION:FEE`,
    });
  }

  await prisma.cashLedger.createMany({ data: ledgerEntries });

  return {
    positionCreated: 1,
    positionActionCreated: 1,
    cashLedgerEntriesCreated: ledgerEntries.length,
  };
}

async function ensureTigerOptionExpiredWorthlessBundle(input: {
  bundle: TigerOptionExpiryBundle;
  brokerAccountId: string;
  importBatchId: string;
  importCurrency: string;
}) {
  const { bundle, brokerAccountId, importBatchId, importCurrency } = input;
  const seedRow = bundle.componentRows[0];
  if (!seedRow) {
    throw new Error("Tiger option expiry bundle is empty.");
  }

  const actionTimestamp = toDateOrNow(seedRow.eventTimestamp);
  const importReference = getImportReference(importBatchId, seedRow.rowNumber);
  const expiredLegKeys = new Set(bundle.expiredLegs.map(getTigerSpreadLegContractKey));
  const existingSpread = await findMatchingOpenTigerSpreadPosition({
    brokerAccountId,
    underlyingSymbol: seedRow.underlyingSymbol,
    spreadLegs: bundle.expiredLegs,
  });

  const bundleTargets = existingSpread
    ? [{
      position: existingSpread.position,
      matchingActiveLegs: existingSpread.activeOptionLegs.filter((leg) => {
        const optionType = leg.optionType as OptionType | null;
        const expiryDate = leg.expiryDate as Date | null;
        const strikePrice = Number(leg.strikePrice?.toString() ?? "NaN");
        if (!optionType || !expiryDate || !Number.isFinite(strikePrice)) {
          return false;
        }

        return expiredLegKeys.has(getTigerSpreadLegContractKey({
          underlyingSymbol: leg.underlyingSymbol,
          optionType,
          expiryDate,
          strikePrice,
        }));
      }),
    }]
    : await findOpenTigerPositionsCoveringSpreadLegs({
      brokerAccountId,
      underlyingSymbol: seedRow.underlyingSymbol,
      spreadLegs: bundle.expiredLegs,
    });

  if (!bundleTargets || bundleTargets.length === 0) {
    throw new Error("Cannot match Tiger expired option bundle to an open position.");
  }

  for (const target of bundleTargets) {
    if (target.matchingActiveLegs.length === 0) {
      continue;
    }

    for (const leg of target.matchingActiveLegs) {
      await prisma.positionLeg.update({
        where: { id: leg.id },
        data: {
          legStatus: LegStatus.EXPIRED,
          closedAt: actionTimestamp,
        },
      });
    }

    const refreshedLegs = await prisma.positionLeg.findMany({
      where: {
        positionId: target.position.id,
        legType: LegType.OPTION,
      },
    });

    const remainingActiveLegs = refreshedLegs.filter((leg) => isActiveLegStatus(leg.legStatus as LegStatus));
    const resultingStatus = remainingActiveLegs.length > 0 ? PositionStatus.PARTIALLY_CLOSED : PositionStatus.EXPIRED;
    const targetQuantity = Number(target.matchingActiveLegs[0]?.quantity?.toString() ?? bundle.quantity);

    await prisma.position.update({
      where: { id: target.position.id },
      data: {
        currentStatus: resultingStatus,
        closedAt: resultingStatus === PositionStatus.EXPIRED ? actionTimestamp : null,
      },
    });

    await prisma.positionAction.create({
      data: {
        positionId: target.position.id,
        actionTimestamp,
        actionType: PositionActionType.EXPIRED_WORTHLESS,
        actionEffect: ActionEffectType.EXPIRE,
        amount: "0",
        feeAmount: "0",
        currency: importCurrency,
        quantity: toDecimalString(targetQuantity),
        premiumPerUnit: "0",
        resultingStatus,
        notes: `Imported option expiry from Tiger (${importReference})`,
        brokerReference: importReference,
      },
    });
  }

  return {
    positionCreated: 0,
    positionActionCreated: bundleTargets.length,
    cashLedgerEntriesCreated: 0,
  };
}

async function ensureTigerSingleOptionExpiredWorthless(input: {
  row: TigerNormalizedTradeRow;
  brokerAccountId: string;
  importBatchId: string;
  importCurrency: string;
}) {
  const { row, brokerAccountId, importBatchId, importCurrency } = input;
  const optionDetails = getTigerOptionDetails(row.symbol);
  if (!optionDetails) {
    throw new Error("Tiger expired option contract could not be parsed.");
  }

  const legSide = resolveTigerExpiredLegSide(row);
  const existingPosition = await findMatchingOpenTigerOptionPosition(
    brokerAccountId,
    row,
    optionDetails,
    legSide,
  );

  if (!existingPosition) {
    throw new Error("Cannot match Tiger expired option row to an open option position.");
  }

  const actionTimestamp = toDateOrNow(row.eventTimestamp);
  const importReference = getImportReference(importBatchId, row.rowNumber);
  const quantity = Math.abs(row.quantity ?? 0);

  await prisma.positionLeg.update({
    where: { id: existingPosition.leg.id },
    data: {
      legStatus: LegStatus.EXPIRED,
      closedAt: actionTimestamp,
    },
  });

  const refreshedLegs = await prisma.positionLeg.findMany({
    where: {
      positionId: existingPosition.position.id,
      legType: LegType.OPTION,
    },
    select: {
      legStatus: true,
    },
  });

  const remainingActiveLegs = refreshedLegs.filter((leg) => isActiveLegStatus(leg.legStatus as LegStatus));
  const resultingStatus = remainingActiveLegs.length > 0 ? PositionStatus.PARTIALLY_CLOSED : PositionStatus.EXPIRED;

  await prisma.position.update({
    where: { id: existingPosition.position.id },
    data: {
      currentStatus: resultingStatus,
      closedAt: resultingStatus === PositionStatus.EXPIRED ? actionTimestamp : null,
    },
  });

  await prisma.positionAction.create({
    data: {
      positionId: existingPosition.position.id,
      actionTimestamp,
      actionType: PositionActionType.EXPIRED_WORTHLESS,
      actionEffect: ActionEffectType.EXPIRE,
      amount: "0",
      feeAmount: "0",
      currency: importCurrency,
      quantity: toDecimalString(quantity),
      premiumPerUnit: "0",
      resultingStatus,
      notes: `Imported option expiry from Tiger (${importReference})`,
      brokerReference: importReference,
    },
  });

  return {
    positionCreated: 0,
    positionActionCreated: 1,
    cashLedgerEntriesCreated: 0,
  };
}

export async function importTigerCsv(input: ImportTigerCsvInput): Promise<ImportTigerCsvResult> {
  const preview = normalizeTigerTradeRows(input.csvText);

  if (preview.missingRequiredColumns.length > 0) {
    throw new Error(`CSV is missing required Tiger columns: ${preview.missingRequiredColumns.join(", ")}.`);
  }

  const fileHash = createHash("sha256").update(input.csvText).digest("hex");
  const brokerAccount = await prisma.brokerAccount.findUnique({
    where: { id: input.brokerAccountId },
    select: { baseCurrency: true },
  });

  if (!brokerAccount) {
    throw new Error("Broker account not found.");
  }

  const importCurrency = brokerAccount.baseCurrency;
  const existingBatch = await prisma.importBatch.findFirst({
    where: {
      brokerAccountId: input.brokerAccountId,
      fileHash,
    },
  });

  if (existingBatch) {
    throw new Error("This CSV file was already imported for the selected broker account.");
  }

  const importBatch = await prisma.importBatch.create({
    data: {
      brokerAccountId: input.brokerAccountId,
      sourceType: ImportSourceType.CSV,
      batchStatus: ImportBatchStatus.PROCESSING,
      importLabel: `Tiger import ${new Date().toISOString()}`,
      fileName: input.fileName,
      fileHash,
      parserVersion: IMPORTER_VERSION,
      rowCount: preview.summary.totalRows,
      processedCount: 0,
      errorCount: 0,
      notes: "Created by Tiger CSV importer",
    },
  });

  let importedRows = 0;
  let failedRows = 0;
  let holdingsCreated = 0;
  let holdingEventsCreated = 0;
  let positionsCreated = 0;
  let positionActionsCreated = 0;
  let rawTransactionsCreated = 0;
  let cashLedgerEntriesCreated = 0;
  const failures: Array<{ rowNumber: number; symbol: string; reason: string }> = [];

  const rowsByProcessingOrder = sortRowsForProcessing(preview.rows);
  const tigerOptionBundles = buildTigerOptionBundleRowNumbers(preview.rows);
  const tigerOptionExpiries = buildTigerOptionExpiryGroups(preview.rows);

  for (const row of rowsByProcessingOrder) {
    const importReference = getImportReference(importBatch.id, row.rowNumber);
    const isImportable = row.skipReason === null;

    const rawTransaction = await prisma.rawTransaction.create({
      data: {
        importBatchId: importBatch.id,
        brokerAccountId: input.brokerAccountId,
        rawTxnType: isImportable ? RawTransactionType.TRADE : RawTransactionType.OTHER,
        brokerTransactionId: importReference,
        brokerOrderId: importReference,
        eventTimestamp: row.eventTimestamp ? new Date(row.eventTimestamp) : null,
        symbolText: row.symbol,
        descriptionText: row.name || null,
        amount: row.amount !== null ? toDecimalString(row.amount) : null,
        quantity: row.quantity !== null ? toDecimalString(row.quantity) : null,
        price: row.price !== null ? toDecimalString(row.price) : null,
        feeAmount: toDecimalString(Math.abs(row.feeAmount)),
        currency: importCurrency,
        rawPayload: row,
        processingNotes: isImportable ? "Importable" : `Skipped: ${row.skipReason}`,
      },
    });
    rawTransactionsCreated += 1;

    if (tigerOptionExpiries.consumedComponentRowNumbers.has(row.rowNumber)) {
      await prisma.rawTransaction.update({
        where: { id: rawTransaction.id },
        data: {
          processingNotes: "Skipped: Tiger option expiry component row (handled by grouped expiry import)",
        },
      });
      continue;
    }

    if (tigerOptionBundles.consumedComponentRowNumbers.has(row.rowNumber)) {
      await prisma.rawTransaction.update({
        where: { id: rawTransaction.id },
        data: {
          processingNotes: "Skipped: Tiger option bundle component row (handled by grouped bundle import)",
        },
      });
      continue;
    }

    if (!isImportable) {
      continue;
    }

    try {
      if (row.assetType === "HOLDING") {
        const result = await ensureTigerHoldingForRow(row, input.brokerAccountId, importBatch.id, importCurrency);
        holdingsCreated += result.holdingCreated;
        holdingEventsCreated += result.holdingEventCreated;
        cashLedgerEntriesCreated += result.cashLedgerEntriesCreated;
        importedRows += 1;
        continue;
      }

      const tigerRoll = tigerOptionBundles.rollsBySeedRowNumber.get(row.rowNumber);
      if (tigerRoll) {
        const result = await ensureTigerOptionRoll({
          roll: tigerRoll,
          brokerAccountId: input.brokerAccountId,
          importBatchId: importBatch.id,
          importCurrency,
        });
        positionsCreated += result.positionCreated;
        positionActionsCreated += result.positionActionCreated;
        cashLedgerEntriesCreated += result.cashLedgerEntriesCreated;
        importedRows += 1;
        continue;
      }

      const tigerExpiryBundle = tigerOptionExpiries.bundlesBySeedRowNumber.get(row.rowNumber);
      if (tigerExpiryBundle) {
        const result = await ensureTigerOptionExpiredWorthlessBundle({
          bundle: tigerExpiryBundle,
          brokerAccountId: input.brokerAccountId,
          importBatchId: importBatch.id,
          importCurrency,
        });
        positionsCreated += result.positionCreated;
        positionActionsCreated += result.positionActionCreated;
        cashLedgerEntriesCreated += result.cashLedgerEntriesCreated;
        importedRows += 1;
        continue;
      }

      if (row.sourceSection === "Exercise and Expiration" && row.side.toUpperCase() === "OPTION EXPIRE") {
        const result = await ensureTigerSingleOptionExpiredWorthless({
          row,
          brokerAccountId: input.brokerAccountId,
          importBatchId: importBatch.id,
          importCurrency,
        });
        positionsCreated += result.positionCreated;
        positionActionsCreated += result.positionActionCreated;
        cashLedgerEntriesCreated += result.cashLedgerEntriesCreated;
        importedRows += 1;
        continue;
      }

      const tigerBundle = tigerOptionBundles.bundlesBySeedRowNumber.get(row.rowNumber);
      if (tigerBundle) {
        const result = await ensureTigerOptionBundle({
          bundle: tigerBundle,
          brokerAccountId: input.brokerAccountId,
          importBatchId: importBatch.id,
          importCurrency,
        });
        positionsCreated += result.positionCreated;
        positionActionsCreated += result.positionActionCreated;
        cashLedgerEntriesCreated += result.cashLedgerEntriesCreated;
        importedRows += 1;
        continue;
      }

      if (tigerOptionBundles.unsupportedBundledRowNumbers.has(row.rowNumber)) {
        throw new Error("Tiger multi-leg option bundle is not supported yet for this structure.");
      }

      const result = await ensureTigerSingleOptionForRow(row, input.brokerAccountId, importBatch.id, importCurrency);
      positionsCreated += result.positionCreated;
      positionActionsCreated += result.positionActionCreated;
      cashLedgerEntriesCreated += result.cashLedgerEntriesCreated;
      importedRows += 1;
    } catch (error) {
      failedRows += 1;
      const reason = error instanceof Error ? error.message : "Unknown Tiger import failure";
      failures.push({
        rowNumber: row.rowNumber,
        symbol: row.symbol,
        reason,
      });

      await prisma.rawTransaction.update({
        where: { id: rawTransaction.id },
        data: {
          processingNotes: `Failed: ${reason}`,
        },
      });
    }
  }

  const finalStatus = failedRows === 0
    ? ImportBatchStatus.COMPLETED
    : importedRows > 0
      ? ImportBatchStatus.PARTIAL
      : ImportBatchStatus.FAILED;

  await prisma.importBatch.update({
    where: { id: importBatch.id },
    data: {
      batchStatus: finalStatus,
      processedCount: importedRows,
      errorCount: failedRows,
      completedAt: new Date(),
      notes: failures.length > 0
        ? `${failures.length} row(s) failed.`
        : "Import completed successfully.",
    },
  });

  await syncPnlSnapshotsForImportBatch(importBatch.id);

  return {
    importBatchId: importBatch.id,
    fileHash,
    summary: {
      totalRows: preview.summary.totalRows,
      processableRows: preview.summary.processableRows,
      skippedRows: preview.summary.totalRows - preview.summary.processableRows,
      importedRows,
      failedRows,
      holdingsCreated,
      holdingEventsCreated,
      positionsCreated,
      positionActionsCreated,
      rawTransactionsCreated,
      cashLedgerEntriesCreated,
    },
    failures,
  };
}
