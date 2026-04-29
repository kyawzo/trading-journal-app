import {
  ActionEffectType,
  AssetClass,
  HoldingEventType,
  HoldingSourceType,
  HoldingStatus,
  ImportBatchStatus,
  ImportSourceType,
  CashTxnType,
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
import { parseMoomooCsvPreview, type MoomooPreviewRow } from "./parser";

const IMPORTER_VERSION = "moomoo-v1";
const STOCK_PURCHASE_TXN_TYPE = "STOCK_PURCHASE" as CashTxnType;
const STOCK_SALE_TXN_TYPE = "STOCK_SALE" as CashTxnType;

type ImportMoomooCsvInput = {
  brokerAccountId: string;
  fileName: string;
  csvText: string;
};

type ImportMoomooCsvResult = {
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

function toDateOrNow(value: string | null) {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toDecimalString(value: number) {
  return value.toString();
}

function getImportReference(importBatchId: string, rowNumber: number) {
  return `IMPORT:${importBatchId}:ROW:${rowNumber}`;
}

function getOptionDetails(symbol: string) {
  const match = symbol.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d+)$/);
  if (!match) {
    return null;
  }

  const [, underlyingSymbol, yy, mm, dd, cp, strikeRaw] = match;
  const year = Number(`20${yy}`);
  const month = Number(mm);
  const day = Number(dd);
  const strikeValue = Number(strikeRaw) / 1000;

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(strikeValue)) {
    return null;
  }

  const expiryDate = new Date(Date.UTC(year, month - 1, day));
  return {
    underlyingSymbol,
    optionType: cp === "C" ? OptionType.CALL : OptionType.PUT,
    expiryDate,
    strikePrice: strikeValue,
  };
}

type SpreadOptionLeg = {
  underlyingSymbol: string;
  optionType: OptionType;
  expiryDate: Date;
  strikePrice: number;
};

function parseCompactOptionToken(underlyingSymbol: string, token: string): SpreadOptionLeg | null {
  const match = token.match(/^(\d{6})([CP])(\d+)$/);
  if (!match) {
    return null;
  }

  const [, yymmdd, cp, strikeToken] = match;
  const year = Number(`20${yymmdd.slice(0, 2)}`);
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  const strikePrice = Number(strikeToken) / 10;

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(strikePrice)) {
    return null;
  }

  return {
    underlyingSymbol,
    optionType: cp === "C" ? OptionType.CALL : OptionType.PUT,
    expiryDate: new Date(Date.UTC(year, month - 1, day)),
    strikePrice,
  };
}

function parseCompactOptionTokenWithFallback(
  underlyingSymbol: string,
  token: string,
  defaults?: { optionType: OptionType; expiryDate: Date },
): SpreadOptionLeg | null {
  const fullTokenLeg = parseCompactOptionToken(underlyingSymbol, token);
  if (fullTokenLeg) {
    return fullTokenLeg;
  }

  const cpStrikeMatch = token.match(/^([CP])(\d+)$/);
  if (cpStrikeMatch && defaults) {
    const [, cp, strikeToken] = cpStrikeMatch;
    const strikePrice = Number(strikeToken) / 10;
    if (!Number.isFinite(strikePrice)) {
      return null;
    }

    return {
      underlyingSymbol,
      optionType: cp === "C" ? OptionType.CALL : OptionType.PUT,
      expiryDate: new Date(defaults.expiryDate),
      strikePrice,
    };
  }

  const strikeOnlyMatch = token.match(/^(\d+)$/);
  if (strikeOnlyMatch && defaults) {
    const strikePrice = Number(strikeOnlyMatch[1]) / 10;
    if (!Number.isFinite(strikePrice)) {
      return null;
    }

    return {
      underlyingSymbol,
      optionType: defaults.optionType,
      expiryDate: new Date(defaults.expiryDate),
      strikePrice,
    };
  }

  const dateStrikeMatch = token.match(/^(\d{6})(\d+)$/);
  if (dateStrikeMatch && defaults) {
    const [, yymmdd, strikeToken] = dateStrikeMatch;
    const year = Number(`20${yymmdd.slice(0, 2)}`);
    const month = Number(yymmdd.slice(2, 4));
    const day = Number(yymmdd.slice(4, 6));
    const strikePrice = Number(strikeToken) / 10;
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(strikePrice)) {
      return null;
    }

    return {
      underlyingSymbol,
      optionType: defaults.optionType,
      expiryDate: new Date(Date.UTC(year, month - 1, day)),
      strikePrice,
    };
  }

  return null;
}

function parseSpreadOptionSymbol(symbol: string): SpreadOptionLeg[] | null {
  const [left, right] = symbol.toUpperCase().split("/");
  if (!left || !right) {
    return null;
  }

  const leftMatch = left.match(/^([A-Z]+)(\d{6}[CP]\d+)$/);
  if (!leftMatch) {
    return null;
  }

  const underlyingSymbol = leftMatch[1];
  const leftToken = leftMatch[2];
  const rightToken = right.startsWith(underlyingSymbol) ? right.slice(underlyingSymbol.length) : right;

  const leftLeg = parseCompactOptionTokenWithFallback(underlyingSymbol, leftToken);
  const rightLeg = parseCompactOptionTokenWithFallback(underlyingSymbol, rightToken, leftLeg ? {
    optionType: leftLeg.optionType,
    expiryDate: leftLeg.expiryDate,
  } : undefined);

  if (!leftLeg || !rightLeg) {
    return null;
  }

  return [leftLeg, rightLeg];
}

function isSameContractDate(left: Date | null | undefined, right: Date | null | undefined) {
  if (!left || !right) {
    return false;
  }

  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

function getDaysToExpiry(actionTimestamp: Date, expiryDate: Date) {
  return (expiryDate.getTime() - actionTimestamp.getTime()) / (1000 * 60 * 60 * 24);
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
  spreadLegs: SpreadOptionLeg[];
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
  spreadLegs: SpreadOptionLeg[];
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

async function deriveStrategyTypeForNewOptionPosition(input: {
  brokerAccountId: string;
  underlyingSymbol: string;
  optionDetails: ReturnType<typeof getOptionDetails>;
  actionType: PositionActionType;
  actionTimestamp: Date;
}) {
  const { brokerAccountId, underlyingSymbol, optionDetails, actionType, actionTimestamp } = input;

  if (!optionDetails) {
    return StrategyType.CUSTOM;
  }

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

  if (actionType === PositionActionType.BTO) {
    const daysToExpiry = getDaysToExpiry(actionTimestamp, optionDetails.expiryDate);
    const isLeaps = daysToExpiry >= 270;

    if (optionDetails.optionType === OptionType.CALL) {
      return isLeaps ? StrategyType.LEAPS_CALL : StrategyType.LONG_CALL;
    }

    if (optionDetails.optionType === OptionType.PUT) {
      return isLeaps ? StrategyType.LEAPS_PUT : StrategyType.LONG_PUT;
    }
  }

  return StrategyType.CUSTOM;
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

async function findMatchingOpenOptionPosition(
  brokerAccountId: string,
  row: MoomooPreviewRow,
  optionDetails: NonNullable<ReturnType<typeof getOptionDetails>>,
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

async function findRecentClosedShortPositionForRoll(input: {
  brokerAccountId: string;
  underlyingSymbol: string;
  actionTimestamp: Date;
}) {
  const minTimestamp = new Date(input.actionTimestamp.getTime() - 30 * 60 * 1000);

  const recentClose = await prisma.positionAction.findFirst({
    where: {
      actionType: PositionActionType.BTC,
      actionTimestamp: {
        gte: minTimestamp,
        lte: input.actionTimestamp,
      },
      position: {
        brokerAccountId: input.brokerAccountId,
        underlyingSymbol: input.underlyingSymbol,
      },
      resultingStatus: PositionStatus.CLOSED,
    },
    include: {
      position: true,
    },
    orderBy: [{ actionTimestamp: "desc" }, { createdAt: "desc" }],
  });

  return recentClose?.position ?? null;
}

function isWithinSpreadWindow(baseTimestamp: string | null, candidateTimestamp: string | null) {
  if (!baseTimestamp || !candidateTimestamp) {
    return false;
  }

  const baseMs = new Date(baseTimestamp).getTime();
  const candidateMs = new Date(candidateTimestamp).getTime();
  if (!Number.isFinite(baseMs) || !Number.isFinite(candidateMs)) {
    return false;
  }

  return Math.abs(candidateMs - baseMs) <= 2 * 60 * 1000;
}

function isSameOptionContract(
  details: ReturnType<typeof getOptionDetails>,
  spreadLeg: SpreadOptionLeg,
) {
  if (!details) {
    return false;
  }

  return (
    details.underlyingSymbol === spreadLeg.underlyingSymbol &&
    details.optionType === spreadLeg.optionType &&
    isSameContractDate(details.expiryDate, spreadLeg.expiryDate) &&
    details.strikePrice === spreadLeg.strikePrice
  );
}

function normalizeUnderlyingFamily(symbol: string) {
  return symbol.endsWith("W") && symbol.length > 3 ? symbol.slice(0, -1) : symbol;
}

function isSameUnderlyingFamily(left: string, right: string) {
  return normalizeUnderlyingFamily(left) === normalizeUnderlyingFamily(right);
}

function isVerticalSpreadSummaryRow(row: MoomooPreviewRow) {
  return row.isSpread && row.symbol.includes("/") && row.name.toUpperCase().includes("VERTICAL");
}

function isIronCondorSummaryRow(row: MoomooPreviewRow) {
  return row.isSpread && row.symbol.includes("/") && row.name.toUpperCase().includes("IRON CONDOR");
}

function isCustomSpreadSummaryRow(row: MoomooPreviewRow) {
  return row.isSpread && row.symbol.includes("/") && row.name.toUpperCase().includes("CUSTOM");
}

function isExpiredWorthlessRow(row: MoomooPreviewRow) {
  return row.orderSource.toUpperCase() === "OPTION EXPIRED";
}

function buildSpreadLegsFromComponentRows(componentRows: MoomooPreviewRow[]) {
  const spreadLegs = componentRows
    .map((row) => getOptionDetails(row.symbol))
    .filter((details): details is NonNullable<ReturnType<typeof getOptionDetails>> => details !== null)
    .map((details) => ({
      underlyingSymbol: details.underlyingSymbol,
      optionType: details.optionType,
      expiryDate: details.expiryDate,
      strikePrice: details.strikePrice,
    }));

  return spreadLegs;
}

function getExpiryGroupKey(expiryDate: Date) {
  return expiryDate.toISOString().slice(0, 10);
}

function groupSpreadLegsByExpiry(spreadLegs: SpreadOptionLeg[]) {
  const groups = new Map<string, SpreadOptionLeg[]>();

  for (const leg of spreadLegs) {
    const key = getExpiryGroupKey(leg.expiryDate);
    const current = groups.get(key) ?? [];
    current.push(leg);
    groups.set(key, current);
  }

  return [...groups.entries()]
    .map(([key, legs]) => ({
      key,
      expiryDate: legs[0]?.expiryDate ?? new Date(0),
      legs,
    }))
    .sort((left, right) => left.expiryDate.getTime() - right.expiryDate.getTime());
}

function isRollStyleSpread(spreadLegs: SpreadOptionLeg[] | null) {
  if (!spreadLegs || spreadLegs.length < 2) {
    return false;
  }

  return groupSpreadLegsByExpiry(spreadLegs).length >= 2;
}

function findSpreadSummaryComponentRows(
  summaryRow: MoomooPreviewRow,
  allRows: MoomooPreviewRow[],
) {
  if (!(isVerticalSpreadSummaryRow(summaryRow) || isIronCondorSummaryRow(summaryRow) || isCustomSpreadSummaryRow(summaryRow))) {
    return null;
  }

  const expectedComponentCount = summaryRow.symbol.split("/").length;
  if (expectedComponentCount < 2) {
    return null;
  }

  const directBundleRows = allRows.filter((candidate) => {
    if (candidate.rowNumber === summaryRow.rowNumber) {
      return false;
    }

    if (candidate.rowNumber <= summaryRow.rowNumber || candidate.rowNumber > summaryRow.rowNumber + expectedComponentCount) {
      return false;
    }

    if (candidate.skipReason !== null || candidate.isSpread || !candidate.isOption) {
      return false;
    }

    if (!isSameUnderlyingFamily(candidate.underlyingSymbol, summaryRow.underlyingSymbol)) {
      return false;
    }

    return getOptionDetails(candidate.symbol) !== null;
  });

  if (directBundleRows.length === expectedComponentCount) {
    return {
      componentRows: directBundleRows,
    };
  }

  const matchedRows = allRows.filter((candidate) => {
    if (candidate.rowNumber === summaryRow.rowNumber) {
      return false;
    }

    if (candidate.skipReason !== null || candidate.isSpread || !candidate.isOption) {
      return false;
    }

    if (!isSameUnderlyingFamily(candidate.underlyingSymbol, summaryRow.underlyingSymbol)) {
      return false;
    }

    const isNearbyRow = Math.abs(candidate.rowNumber - summaryRow.rowNumber) <= 3;
    const isInTimeWindow = isWithinSpreadWindow(summaryRow.eventTimestamp, candidate.eventTimestamp)
      || isWithinSpreadWindow(summaryRow.orderTimestamp, candidate.eventTimestamp)
      || isWithinSpreadWindow(summaryRow.eventTimestamp, candidate.orderTimestamp)
      || isWithinSpreadWindow(summaryRow.orderTimestamp, candidate.orderTimestamp);

    if (!(isNearbyRow || isInTimeWindow)) {
      return false;
    }

    return getOptionDetails(candidate.symbol) !== null;
  });

  if (matchedRows.length < expectedComponentCount) {
    return null;
  }

  return {
    componentRows: matchedRows.slice(0, expectedComponentCount),
  };
}

function getSpreadLegContractKey(leg: { optionType: OptionType; expiryDate: Date; strikePrice: number }) {
  return `${leg.optionType}:${leg.expiryDate.toISOString().slice(0, 10)}:${leg.strikePrice.toFixed(4)}`;
}

function getPositionLegContractKey(leg: {
  optionType: OptionType | null;
  expiryDate: Date | null;
  strikePrice: { toString(): string } | null;
}) {
  if (!leg.optionType || !leg.expiryDate || !leg.strikePrice) {
    return null;
  }

  return `${leg.optionType}:${leg.expiryDate.toISOString().slice(0, 10)}:${Number(leg.strikePrice.toString()).toFixed(4)}`;
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

function findExpiredOptionBundleRows(
  seedRow: MoomooPreviewRow,
  allRows: MoomooPreviewRow[],
) {
  if (!seedRow.isOption || seedRow.isSpread || !isExpiredWorthlessRow(seedRow)) {
    return null;
  }

  const seedDetails = getOptionDetails(seedRow.symbol);
  if (!seedDetails) {
    return null;
  }

  const targetTimestamp = seedRow.eventTimestamp ?? seedRow.orderTimestamp ?? seedRow.fillTimestamp;
  if (!targetTimestamp) {
    return null;
  }

  const matchedRows = allRows.filter((candidate) => {
    if (!candidate.isOption || candidate.isSpread || !isExpiredWorthlessRow(candidate)) {
      return false;
    }

    if (!isSameUnderlyingFamily(candidate.underlyingSymbol, seedRow.underlyingSymbol)) {
      return false;
    }

    const candidateDetails = getOptionDetails(candidate.symbol);
    if (!candidateDetails) {
      return false;
    }

    const candidateTimestamp = candidate.eventTimestamp ?? candidate.orderTimestamp ?? candidate.fillTimestamp;
    if (candidateTimestamp !== targetTimestamp) {
      return false;
    }

    return isSameContractDate(candidateDetails.expiryDate, seedDetails.expiryDate);
  });

  return matchedRows.length >= 2 ? matchedRows : null;
}

async function findMatchingOpenSpreadPosition(input: {
  brokerAccountId: string;
  underlyingSymbol: string;
  spreadLegs: SpreadOptionLeg[];
}) {
  const expectedKeys = new Set(input.spreadLegs.map(getSpreadLegContractKey));
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
      actions: {
        select: {
          actionType: true,
          actionTimestamp: true,
        },
        orderBy: [{ actionTimestamp: "asc" }, { createdAt: "asc" }],
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

    if (activeOptionLegs.length < 2) {
      continue;
    }

    const activeKeys = new Set(activeOptionLegs.map((leg) => {
      const optionType = leg.optionType as OptionType | null;
      const expiryDate = leg.expiryDate as Date | null;
      const strikePrice = Number(leg.strikePrice?.toString() ?? "NaN");
      if (!optionType || !expiryDate || !Number.isFinite(strikePrice)) {
        return "INVALID";
      }
      return getSpreadLegContractKey({ optionType, expiryDate, strikePrice });
    }));

    if ([...expectedKeys].every((key) => activeKeys.has(key))) {
      return {
        position,
        activeOptionLegs,
      };
    }
  }

  return null;
}

async function findRecentOpenSpreadPositionByFamily(input: {
  brokerAccountId: string;
  underlyingSymbol: string;
}) {
  const normalizedUnderlying = normalizeUnderlyingFamily(input.underlyingSymbol);
  const underlyingVariants = Array.from(new Set([normalizedUnderlying, `${normalizedUnderlying}W`]));

  return prisma.position.findFirst({
    where: {
      brokerAccountId: input.brokerAccountId,
      underlyingSymbol: {
        in: underlyingVariants,
      },
      assetClass: AssetClass.OPTION,
      currentStatus: {
        in: [PositionStatus.OPEN, PositionStatus.PARTIALLY_CLOSED],
      },
      legs: {
        some: {
          legType: LegType.OPTION,
          legStatus: {
            in: [LegStatus.OPEN, LegStatus.PARTIALLY_CLOSED],
          },
        },
      },
    },
    include: {
      legs: true,
    },
    orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
  });
}

async function ensurePositionExpiredWorthlessBundle(input: {
  componentRows: MoomooPreviewRow[];
  brokerAccountId: string;
  importBatchId: string;
  importCurrency: string;
}) {
  const { componentRows, brokerAccountId, importBatchId } = input;
  const { importCurrency } = input;
  const spreadLegs = buildSpreadLegsFromComponentRows(componentRows);
  if (spreadLegs.length < 2) {
    throw new Error("Unable to parse expired option bundle contracts.");
  }

  const seedRow = componentRows[0];
  if (!seedRow) {
    throw new Error("Expired option bundle is empty.");
  }

  const existingSpread = await findMatchingOpenSpreadPosition({
    brokerAccountId,
    underlyingSymbol: seedRow.underlyingSymbol,
    spreadLegs,
  });

  if (!existingSpread) {
    throw new Error("Cannot match expired option bundle to an open position.");
  }

  const actionTimestamp = toDateOrNow(seedRow.eventTimestamp);
  const quantity = seedRow.quantity ?? componentRows[0]?.quantity ?? 0;
  const importReference = getImportReference(importBatchId, seedRow.rowNumber);
  const expiredLegKeys = new Set(spreadLegs.map(getSpreadLegContractKey));
  const matchingActiveLegs = existingSpread.activeOptionLegs.filter((leg) => {
    const optionType = leg.optionType as OptionType | null;
    const expiryDate = leg.expiryDate as Date | null;
    const strikePrice = Number(leg.strikePrice?.toString() ?? "NaN");

    if (!optionType || !expiryDate || !Number.isFinite(strikePrice)) {
      return false;
    }

    return expiredLegKeys.has(getSpreadLegContractKey({
      optionType,
      expiryDate,
      strikePrice,
    }));
  });

  if (matchingActiveLegs.length === 0) {
    throw new Error("Cannot match expired option legs to active legs on the open position.");
  }

  for (const leg of matchingActiveLegs) {
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
      positionId: existingSpread.position.id,
      legType: LegType.OPTION,
    },
  });

  const remainingActiveLegs = refreshedLegs.filter((leg) => (
    leg.legStatus === LegStatus.OPEN || leg.legStatus === LegStatus.PARTIALLY_CLOSED
  ));
  const resultingStatus = remainingActiveLegs.length > 0 ? PositionStatus.PARTIALLY_CLOSED : PositionStatus.EXPIRED;

  await prisma.position.update({
    where: { id: existingSpread.position.id },
    data: {
      currentStatus: resultingStatus,
      closedAt: resultingStatus === PositionStatus.EXPIRED ? actionTimestamp : null,
    },
  });

  await prisma.positionAction.create({
    data: {
      positionId: existingSpread.position.id,
      actionTimestamp,
      actionType: PositionActionType.EXPIRED_WORTHLESS,
      actionEffect: ActionEffectType.EXPIRE,
      amount: "0",
      feeAmount: "0",
      currency: importCurrency,
      quantity: toDecimalString(quantity),
      premiumPerUnit: "0",
      resultingStatus,
      notes: `Imported option expiry from MooMoo (${importReference})`,
      brokerReference: importReference,
    },
  });

  return {
    positionCreated: 0,
    positionActionCreated: 1,
    cashLedgerEntriesCreated: 0,
  };
}

async function ensurePositionForSpreadBundle(input: {
  summaryRow: MoomooPreviewRow;
  componentRows: MoomooPreviewRow[];
  brokerAccountId: string;
  importBatchId: string;
  importCurrency: string;
}) {
  const { summaryRow, componentRows, brokerAccountId, importBatchId, importCurrency } = input;
  const actionTimestamp = toDateOrNow(summaryRow.eventTimestamp);
  const quantity = summaryRow.quantity ?? componentRows[0]?.quantity ?? 0;
  const premiumPerUnit = summaryRow.price ?? 0;
  const feeAmount = Math.abs(summaryRow.feeAmount ?? 0);
  const importReference = getImportReference(importBatchId, summaryRow.rowNumber);

  const spreadLegs = buildSpreadLegsFromComponentRows(componentRows);

  if (spreadLegs.length < 2) {
    throw new Error("Unable to parse spread component contracts.");
  }

  const summaryIsBuy = summaryRow.side.includes("BUY");
  const summaryIsSell = summaryRow.side.includes("SELL");

  if (!summaryIsBuy && !summaryIsSell) {
    throw new Error(`Unsupported spread summary side: ${summaryRow.side}`);
  }

  const existingSpread = await findMatchingOpenSpreadPosition({
    brokerAccountId,
    underlyingSymbol: summaryRow.underlyingSymbol,
    spreadLegs,
  });

  if (summaryIsBuy && existingSpread) {
    const closeActionType = existingSpread.position.actions.some((action) => action.actionType === PositionActionType.STO)
      ? PositionActionType.BTC
      : PositionActionType.STC;

    for (const leg of existingSpread.activeOptionLegs) {
      await prisma.positionLeg.update({
        where: { id: leg.id },
        data: {
          legStatus: LegStatus.CLOSED,
          closedAt: actionTimestamp,
        },
      });
    }

    await prisma.position.update({
      where: { id: existingSpread.position.id },
      data: {
        currentStatus: PositionStatus.CLOSED,
        closedAt: actionTimestamp,
      },
    });

    await prisma.positionAction.create({
      data: {
        positionId: existingSpread.position.id,
        actionTimestamp,
        actionType: closeActionType,
        actionEffect: ActionEffectType.CLOSE,
        amount: toDecimalString(premiumPerUnit),
        feeAmount: toDecimalString(feeAmount),
        currency: importCurrency,
        quantity: toDecimalString(quantity),
        premiumPerUnit: toDecimalString(premiumPerUnit),
        resultingStatus: PositionStatus.CLOSED,
        notes: `Imported spread close from MooMoo (${importReference})`,
        brokerReference: importReference,
      },
    });

    const premiumNotional = Math.abs(premiumPerUnit * quantity * 100);
    const primaryCashAmount = closeActionType === PositionActionType.BTC
      ? -premiumNotional
      : premiumNotional;

    const ledgerEntries: Array<{
      brokerAccountId: string;
      txnTimestamp: Date;
      txnType: CashTxnType;
      amount: string;
      currency: string;
      linkedHoldingId?: string;
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
        description: `Imported ${closeActionType} premium for ${summaryRow.symbol}`,
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
        linkedPositionId: existingSpread.position.id,
        description: `Imported position fee for ${summaryRow.symbol}`,
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

  const actionType = summaryIsSell ? PositionActionType.STO : PositionActionType.BTO;
  const strategyType = deriveStrategyTypeForSpreadPosition({
    spreadLegs,
    actionType,
  });

  const position = await prisma.position.create({
    data: {
      brokerAccountId,
      sourceType: PositionSourceType.IMPORTED,
      assetClass: AssetClass.OPTION,
      strategyType,
      underlyingSymbol: summaryRow.underlyingSymbol,
      positionTitle: summaryRow.name || summaryRow.symbol,
      openedAt: actionTimestamp,
      currentStatus: PositionStatus.OPEN,
      tradeNotes: `Imported from MooMoo (${importReference})`,
    },
  });

  const spreadBlueprints = buildSpreadLegBlueprints({
    spreadLegs,
    strategyType,
  });

  if (spreadBlueprints.length !== spreadLegs.length) {
    throw new Error("Unable to build spread leg structure from component contracts.");
  }

  await prisma.positionLeg.createMany({
    data: spreadBlueprints.map((leg) => ({
      positionId: position.id,
      legType: LegType.OPTION,
      legSide: leg.legSide,
      optionType: leg.optionType,
      underlyingSymbol: leg.underlyingSymbol,
      expiryDate: leg.expiryDate,
      strikePrice: toDecimalString(leg.strikePrice),
      quantity: toDecimalString(quantity),
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
      actionType,
      actionEffect: ActionEffectType.OPEN,
      amount: toDecimalString(premiumPerUnit),
      feeAmount: toDecimalString(feeAmount),
      currency: importCurrency,
      quantity: toDecimalString(quantity),
      premiumPerUnit: toDecimalString(premiumPerUnit),
      resultingStatus: PositionStatus.OPEN,
      notes: `Imported spread bundle from MooMoo (${importReference})`,
      brokerReference: importReference,
    },
  });

  const premiumNotional = Math.abs(premiumPerUnit * quantity * 100);
  const primaryCashAmount = actionType === PositionActionType.STO ? premiumNotional : -premiumNotional;

  const ledgerEntries: Array<{
    brokerAccountId: string;
    txnTimestamp: Date;
    txnType: CashTxnType;
    amount: string;
    currency: string;
    linkedHoldingId?: string;
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
      description: `Imported ${actionType} premium for ${summaryRow.symbol}`,
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
      description: `Imported position fee for ${summaryRow.symbol}`,
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

async function ensurePositionRollFromSpreadSummaryRow(input: {
  summaryRow: MoomooPreviewRow;
  componentRows: MoomooPreviewRow[];
  brokerAccountId: string;
  importBatchId: string;
  importCurrency: string;
}) {
  const { summaryRow, componentRows, brokerAccountId, importBatchId, importCurrency } = input;

  const quantity = summaryRow.quantity ?? componentRows[0]?.quantity ?? 0;
  const premiumPerUnit = summaryRow.price ?? 0;
  const feeAmount = Math.abs(summaryRow.feeAmount ?? 0);
  const actionTimestamp = toDateOrNow(summaryRow.eventTimestamp);
  const importReference = getImportReference(importBatchId, summaryRow.rowNumber);

  if (quantity <= 0) {
    throw new Error("Spread roll summary row has invalid quantity.");
  }

  const spreadLegs = buildSpreadLegsFromComponentRows(componentRows);
  const expiryGroups = groupSpreadLegsByExpiry(spreadLegs);

  if (spreadLegs.length < 4 || expiryGroups.length < 2) {
    throw new Error("Unable to parse roll component option contracts from spread summary.");
  }

  const oldLegGroup = expiryGroups[0]?.legs ?? [];
  const newLegGroup = expiryGroups[expiryGroups.length - 1]?.legs ?? [];

  if (oldLegGroup.length < 2 || newLegGroup.length < 2) {
    throw new Error("Unable to identify old and new spread legs for roll import.");
  }

  const exactExistingSpread = await findMatchingOpenSpreadPosition({
    brokerAccountId,
    underlyingSymbol: summaryRow.underlyingSymbol,
    spreadLegs: oldLegGroup,
  });

  const fallbackExistingSpread = exactExistingSpread
    ? null
    : await findRecentOpenSpreadPositionByFamily({
      brokerAccountId,
      underlyingSymbol: summaryRow.underlyingSymbol,
    });

  const basePosition = exactExistingSpread?.position ?? fallbackExistingSpread;
  if (!basePosition) {
    throw new Error("Cannot apply roll: source spread position was not found as an open position.");
  }

  const activeOptionLegs = basePosition.legs.filter((leg) => (
    leg.legType === LegType.OPTION &&
    (leg.legStatus === LegStatus.OPEN || leg.legStatus === LegStatus.PARTIALLY_CLOSED)
  ));

  if (activeOptionLegs.length === 0) {
    throw new Error("Cannot apply roll: source spread position has no active legs.");
  }

  const oldLegKeys = new Set(oldLegGroup.map(getSpreadLegContractKey));
  const matchingOldLegs = activeOptionLegs.filter((leg) => {
    const contractKey = getPositionLegContractKey({
      optionType: leg.optionType as OptionType | null,
      expiryDate: leg.expiryDate as Date | null,
      strikePrice: leg.strikePrice,
    });

    return contractKey !== null && oldLegKeys.has(contractKey);
  });

  if (matchingOldLegs.length === 0) {
    throw new Error("Cannot apply roll: source spread legs were not found on the open position.");
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
    spreadLegs: newLegGroup,
    actionType: PositionActionType.STO,
  });
  const spreadBlueprints = buildSpreadLegBlueprints({
    spreadLegs: newLegGroup,
    strategyType: nextStrategyType,
  });

  const hasUntouchedActiveLegs = activeOptionLegs.some((leg) => !matchingOldLegs.some((oldLeg) => oldLeg.id === leg.id));

  for (const leg of spreadBlueprints) {
    const parentLeg = matchingOldLegs.find((candidate) => (
      candidate.legSide === leg.legSide &&
      candidate.optionType === leg.optionType
    )) ?? matchingOldLegs.find((candidate) => candidate.legRole === leg.legRole) ?? null;

    await prisma.positionLeg.create({
      data: {
        positionId: basePosition.id,
        legType: LegType.OPTION,
        legSide: leg.legSide,
        optionType: leg.optionType,
        underlyingSymbol: leg.underlyingSymbol,
        expiryDate: leg.expiryDate,
        strikePrice: toDecimalString(leg.strikePrice),
        quantity: toDecimalString(quantity),
        multiplier: "100",
        legRole: parentLeg?.legRole ?? leg.legRole,
        openedAt: actionTimestamp,
        legStatus: LegStatus.OPEN,
        parentLegId: parentLeg?.id ?? null,
      },
    });
  }

  const actionType = premiumPerUnit < 0
    ? PositionActionType.ROLL_CREDIT
    : PositionActionType.ROLL_DEBIT;

  await prisma.position.update({
    where: { id: basePosition.id },
    data: {
      currentStatus: PositionStatus.OPEN,
      closedAt: null,
      strategyType: hasUntouchedActiveLegs ? basePosition.strategyType : nextStrategyType,
    },
  });

  await prisma.positionAction.create({
    data: {
      positionId: basePosition.id,
      actionTimestamp,
      actionType,
      actionEffect: ActionEffectType.ROLL,
      amount: toDecimalString(premiumPerUnit),
      feeAmount: toDecimalString(feeAmount),
      currency: importCurrency,
      quantity: toDecimalString(quantity),
      premiumPerUnit: toDecimalString(premiumPerUnit),
      resultingStatus: PositionStatus.OPEN,
      notes: `Imported spread roll summary from MooMoo (${importReference})`,
      brokerReference: importReference,
    },
  });

  const premiumNotional = Math.abs(premiumPerUnit * quantity * 100);
  const primaryCashAmount = actionType === PositionActionType.ROLL_DEBIT
    ? -premiumNotional
    : premiumNotional;

  const ledgerEntries: Array<{
    brokerAccountId: string;
    txnTimestamp: Date;
    txnType: CashTxnType;
    amount: string;
    currency: string;
    linkedHoldingId?: string;
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
      linkedPositionId: basePosition.id,
      description: `Imported ${actionType} premium for ${summaryRow.symbol}`,
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
        linkedPositionId: basePosition.id,
        description: `Imported position fee for ${summaryRow.symbol}`,
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

async function ensureHoldingForRow(
  row: MoomooPreviewRow,
  brokerAccountId: string,
  importBatchId: string,
  importCurrency: string,
) {
  const quantity = row.quantity ?? 0;
  const pricePerShare = row.price ?? 0;
  const amount = row.amount ?? quantity * pricePerShare;
  const feeAmount = Math.abs(row.feeAmount ?? 0);
  const eventTimestamp = toDateOrNow(row.eventTimestamp);
  const isBuy = row.side.includes("BUY");
  const isSell = row.side.includes("SELL");

  if (quantity <= 0 || pricePerShare < 0) {
    throw new Error("Holding row has invalid quantity or price.");
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
        notes: `Imported from MooMoo (${importReference}) - auto-seeded opening inventory`,
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
        notes: `Auto-seeded opening inventory for import (${importReference})`,
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
        notes: `Imported from MooMoo (${importReference})`,
      },
    });
    holdingCreatedCount = 1;
  }

  if (!holding) {
    throw new Error("Failed to initialize holding for import.");
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
          notes: `Auto-seeded missing opening quantity for import (${importReference})`,
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
    throw new Error(`Unsupported holding side: ${row.side}`);
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
      notes: `Imported from MooMoo (${importReference})`,
    },
  });

  const ledgerEntries: Array<{
    brokerAccountId: string;
    txnTimestamp: Date;
    txnType: CashTxnType;
    amount: string;
    currency: string;
    linkedHoldingId?: string;
    linkedPositionId?: string;
    description: string;
    externalReference: string;
  }> = [];
  const grossAmount = Math.abs(amount);

  if (eventType === HoldingEventType.ACQUIRED) {
    ledgerEntries.push({
      brokerAccountId,
      txnTimestamp: eventTimestamp,
      txnType: STOCK_PURCHASE_TXN_TYPE,
      amount: toDecimalString(-grossAmount),
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
      amount: toDecimalString(grossAmount),
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

async function ensurePositionForRow(
  row: MoomooPreviewRow,
  brokerAccountId: string,
  importBatchId: string,
  importCurrency: string,
) {
  const quantity = row.quantity ?? 0;
  const premiumPerUnit = row.price ?? 0;
  const feeAmount = Math.abs(row.feeAmount ?? 0);
  const actionTimestamp = toDateOrNow(row.eventTimestamp);
  const importReference = getImportReference(importBatchId, row.rowNumber);

  if (quantity <= 0 || premiumPerUnit < 0) {
    throw new Error("Position row has invalid quantity or price.");
  }

  const sideUpper = row.side.toUpperCase();
  const isBuy = sideUpper.includes("BUY");
  const isShortSell = sideUpper.includes("SHORT");
  const isSell = sideUpper.includes("SELL");
  const optionDetails = getOptionDetails(row.symbol);
  const spreadLegs = row.isSpread ? parseSpreadOptionSymbol(row.symbol) : null;

  const actionType = isShortSell
    ? PositionActionType.STO
    : isBuy
      ? PositionActionType.BTO
      : isSell
        ? PositionActionType.STO
        : PositionActionType.STO;
  const direction = actionType === PositionActionType.STO ? LegSide.SHORT : LegSide.LONG;
  const coveredCallSharesRequired = quantity * 100;
  const linkedCoveredCallHolding = (
    optionDetails &&
    actionType === PositionActionType.STO &&
    optionDetails.optionType === OptionType.CALL
  )
    ? await findCoveredCallHolding({
      brokerAccountId,
      underlyingSymbol: row.underlyingSymbol,
      requiredShares: coveredCallSharesRequired,
    })
    : null;

  if (row.isSpread && spreadLegs && isBuy) {
    const existingSpread = await findMatchingOpenSpreadPosition({
      brokerAccountId,
      underlyingSymbol: row.underlyingSymbol,
      spreadLegs,
    });

    if (existingSpread) {
      const actionTimestamp = toDateOrNow(row.eventTimestamp);
      const feeAmount = Math.abs(row.feeAmount ?? 0);
      const quantity = row.quantity ?? 0;
      const premiumPerUnit = row.price ?? 0;
      const importReference = getImportReference(importBatchId, row.rowNumber);
      const openedByStO = existingSpread.position.actions.some((action) => action.actionType === PositionActionType.STO);
      const closeActionType = openedByStO ? PositionActionType.BTC : PositionActionType.STC;

      for (const leg of existingSpread.activeOptionLegs) {
        await prisma.positionLeg.update({
          where: { id: leg.id },
          data: {
            legStatus: LegStatus.CLOSED,
            closedAt: actionTimestamp,
          },
        });
      }

      await prisma.position.update({
        where: { id: existingSpread.position.id },
        data: {
          currentStatus: PositionStatus.CLOSED,
          closedAt: actionTimestamp,
        },
      });

      await prisma.positionAction.create({
        data: {
          positionId: existingSpread.position.id,
          actionTimestamp,
          actionType: closeActionType,
          actionEffect: ActionEffectType.CLOSE,
          amount: toDecimalString(premiumPerUnit),
          feeAmount: toDecimalString(feeAmount),
          currency: importCurrency,
          quantity: toDecimalString(quantity),
          premiumPerUnit: toDecimalString(premiumPerUnit),
          resultingStatus: PositionStatus.CLOSED,
          notes: `Imported spread close from MooMoo (${importReference})`,
          brokerReference: importReference,
        },
      });

      const premiumNotional = Math.abs(premiumPerUnit * quantity * 100);
      const primaryCashAmount = closeActionType === PositionActionType.BTC
        ? -premiumNotional
        : premiumNotional;

      const ledgerEntries: Array<{
        brokerAccountId: string;
        txnTimestamp: Date;
        txnType: CashTxnType;
        amount: string;
        currency: string;
        linkedHoldingId?: string;
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
          description: `Imported ${closeActionType} premium for ${row.symbol}`,
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
          linkedPositionId: existingSpread.position.id,
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
  }

  if (optionDetails && isBuy) {
    const existingShort = await findMatchingOpenOptionPosition(
      brokerAccountId,
      row,
      optionDetails,
      LegSide.SHORT,
    );

    if (existingShort) {
      const currentLegQty = Number(existingShort.leg.quantity.toString());
      if (currentLegQty + 0.0000001 < quantity) {
        throw new Error(`BTC quantity ${quantity} is greater than open short quantity ${currentLegQty}.`);
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
          notes: `Imported from MooMoo (${importReference})`,
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
        linkedHoldingId?: string;
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
  }

  if (optionDetails && isSell && !isShortSell) {
    const existingLong = await findMatchingOpenOptionPosition(
      brokerAccountId,
      row,
      optionDetails,
      LegSide.LONG,
    );

    if (existingLong) {
      const currentLegQty = Number(existingLong.leg.quantity.toString());
      if (currentLegQty + 0.0000001 < quantity) {
        throw new Error(`STC quantity ${quantity} is greater than open long quantity ${currentLegQty}.`);
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
          notes: `Imported from MooMoo (${importReference})`,
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
        linkedHoldingId?: string;
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
  }

  if (optionDetails && (isShortSell || isSell)) {
    const rollCandidate = await findRecentClosedShortPositionForRoll({
      brokerAccountId,
      underlyingSymbol: row.underlyingSymbol,
      actionTimestamp,
    });

    if (rollCandidate) {
      await prisma.position.update({
        where: { id: rollCandidate.id },
        data: {
          currentStatus: PositionStatus.OPEN,
          closedAt: null,
          linkedHoldingId: rollCandidate.linkedHoldingId ?? linkedCoveredCallHolding?.id ?? null,
          strategyType: await deriveStrategyTypeForNewOptionPosition({
            brokerAccountId,
            underlyingSymbol: row.underlyingSymbol,
            optionDetails,
            actionType: PositionActionType.STO,
            actionTimestamp,
          }),
        },
      });

      await prisma.positionLeg.create({
        data: {
          positionId: rollCandidate.id,
          legType: LegType.OPTION,
          legSide: LegSide.SHORT,
          optionType: optionDetails.optionType,
          underlyingSymbol: optionDetails.underlyingSymbol,
          expiryDate: optionDetails.expiryDate,
          strikePrice: toDecimalString(optionDetails.strikePrice),
          quantity: toDecimalString(quantity),
          multiplier: "100",
          legRole: "ROLLED_IN",
          openedAt: actionTimestamp,
          legStatus: LegStatus.OPEN,
        },
      });

      const premiumNotional = Math.abs(premiumPerUnit * quantity * 100);
      const rollActionType = premiumNotional >= 0 ? PositionActionType.ROLL_CREDIT : PositionActionType.ROLL_DEBIT;

      await prisma.positionAction.create({
        data: {
          positionId: rollCandidate.id,
          actionTimestamp,
          actionType: rollActionType,
          actionEffect: ActionEffectType.ROLL,
          amount: toDecimalString(premiumPerUnit),
          feeAmount: toDecimalString(feeAmount),
          currency: importCurrency,
          quantity: toDecimalString(quantity),
          premiumPerUnit: toDecimalString(premiumPerUnit),
          resultingStatus: PositionStatus.OPEN,
          notes: `Imported roll leg from MooMoo (${importReference})`,
          brokerReference: importReference,
        },
      });

      const ledgerEntries: Array<{
        brokerAccountId: string;
        txnTimestamp: Date;
        txnType: CashTxnType;
        amount: string;
        currency: string;
        linkedHoldingId?: string;
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
          linkedPositionId: rollCandidate.id,
          description: `Imported ${rollActionType} premium for ${row.symbol}`,
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
          linkedPositionId: rollCandidate.id,
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
  }

  const derivedStrategyType = spreadLegs && row.isSpread
    ? deriveStrategyTypeForSpreadPosition({ spreadLegs, actionType })
    : await deriveStrategyTypeForNewOptionPosition({
      brokerAccountId,
      underlyingSymbol: row.underlyingSymbol,
      optionDetails,
      actionType,
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
      tradeNotes: `Imported from MooMoo (${importReference})`,
    },
  });

  if (spreadLegs && spreadLegs.length === 2) {
    const spreadBlueprints = buildSpreadLegBlueprints({
      spreadLegs,
      strategyType: derivedStrategyType,
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
          quantity: toDecimalString(quantity),
          multiplier: "100",
          legRole: leg.legRole,
          openedAt: actionTimestamp,
          legStatus: LegStatus.OPEN,
        })),
    });
  } else {
    const inferredSingleLegRole = inferSingleLegRoleForStrategy({
      strategyType: derivedStrategyType,
      legSide: direction,
      optionType: optionDetails?.optionType ?? null,
    });

    await prisma.positionLeg.create({
      data: {
        positionId: position.id,
        legType: LegType.OPTION,
        legSide: direction,
        optionType: optionDetails?.optionType ?? null,
        underlyingSymbol: row.underlyingSymbol,
        expiryDate: optionDetails?.expiryDate ?? null,
        strikePrice: optionDetails ? toDecimalString(optionDetails.strikePrice) : null,
        quantity: toDecimalString(quantity),
        multiplier: "100",
        legRole: row.isSpread ? "SPREAD" : inferredSingleLegRole,
        openedAt: actionTimestamp,
        legStatus: LegStatus.OPEN,
      },
    });
  }

  await prisma.positionAction.create({
    data: {
      positionId: position.id,
      actionTimestamp,
      actionType,
      actionEffect: ActionEffectType.OPEN,
      amount: toDecimalString(premiumPerUnit),
      feeAmount: toDecimalString(feeAmount),
      currency: importCurrency,
      quantity: toDecimalString(quantity),
      premiumPerUnit: toDecimalString(premiumPerUnit),
      resultingStatus: PositionStatus.OPEN,
      notes: `Imported from MooMoo (${importReference})`,
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
    linkedHoldingId?: string;
    linkedPositionId?: string;
    description: string;
    externalReference: string;
  }> = [
    {
      brokerAccountId,
      txnTimestamp: actionTimestamp,
      txnType: CashTxnType.OPTIONS_PREMIUM,
      amount: toDecimalString(actionType === PositionActionType.STO ? premiumNotional : -premiumNotional),
      currency: importCurrency,
      linkedPositionId: position.id,
      description: `Imported ${actionType} premium for ${row.symbol}`,
      externalReference: `${importReference}:POSITION:PRIMARY`,
    },
  ];

  if (feeAmount > 0) {
    ledgerEntries.push({
      brokerAccountId,
      txnTimestamp: actionTimestamp,
      txnType: "COMMISSION" as const,
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

export async function importMoomooCsv(input: ImportMoomooCsvInput): Promise<ImportMoomooCsvResult> {
  const preview = parseMoomooCsvPreview(input.csvText);

  if (preview.missingRequiredColumns.length > 0) {
    throw new Error(`CSV is missing required columns: ${preview.missingRequiredColumns.join(", ")}.`);
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
      importLabel: `MooMoo import ${new Date().toISOString()}`,
      fileName: input.fileName,
      fileHash,
      parserVersion: IMPORTER_VERSION,
      rowCount: preview.summary.totalRows,
      processedCount: 0,
      errorCount: 0,
      notes: "Created by MooMoo CSV importer",
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
  const consumedSpreadComponentRowNumbers = new Set<number>();
  const consumedExpiredBundleRowNumbers = new Set<number>();

  const rowsByProcessingOrder = [...preview.rows].sort((left, right) => {
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

  const shouldSkipSpreadSummaryRow = (row: MoomooPreviewRow) => {
    if (!isVerticalSpreadSummaryRow(row)) {
      return false;
    }

    const eventTs = row.eventTimestamp ? new Date(row.eventTimestamp).getTime() : null;
    if (!eventTs) {
      return false;
    }

    const siblingLegRows = preview.rows.filter((candidate) => {
      if (candidate.rowNumber === row.rowNumber) {
        return false;
      }

      if (candidate.skipReason !== null || candidate.isSpread) {
        return false;
      }

      if (!candidate.symbol.startsWith(row.underlyingSymbol)) {
        return false;
      }

      if (!candidate.eventTimestamp) {
        return false;
      }

      const candidateTs = new Date(candidate.eventTimestamp).getTime();
      return Math.abs(candidateTs - eventTs) <= 2 * 60 * 1000;
    });

    return siblingLegRows.length >= 2;
  };

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

    if (consumedSpreadComponentRowNumbers.has(row.rowNumber)) {
      await prisma.rawTransaction.update({
        where: { id: rawTransaction.id },
        data: {
          processingNotes: "Skipped: spread component row (handled by spread summary roll action)",
        },
      });
      continue;
    }

    if (consumedExpiredBundleRowNumbers.has(row.rowNumber)) {
      await prisma.rawTransaction.update({
        where: { id: rawTransaction.id },
        data: {
          processingNotes: "Skipped: option expiry component row (handled by expiry bundle action)",
        },
      });
      continue;
    }

    if (!isImportable) {
      continue;
    }

    const spreadComponents = findSpreadSummaryComponentRows(row, preview.rows);
    const expiredBundleRows = findExpiredOptionBundleRows(row, preview.rows);

    if (shouldSkipSpreadSummaryRow(row) && !spreadComponents) {
      await prisma.rawTransaction.update({
        where: { id: rawTransaction.id },
        data: {
          processingNotes: "Skipped: spread summary row (component legs imported separately)",
        },
      });
      continue;
    }

    try {
      if (row.assetType === "HOLDING") {
        const result = await ensureHoldingForRow(row, input.brokerAccountId, importBatch.id, importCurrency);
        holdingsCreated += result.holdingCreated;
        holdingEventsCreated += result.holdingEventCreated;
        cashLedgerEntriesCreated += result.cashLedgerEntriesCreated;
      } else {
        const spreadLegs = row.isSpread ? parseSpreadOptionSymbol(row.symbol) : null;
        const shouldProcessAsSpreadBundle = Boolean(spreadComponents);
        const bundledSpreadLegs = spreadComponents
          ? buildSpreadLegsFromComponentRows(spreadComponents.componentRows)
          : spreadLegs;
        const shouldProcessAsSpreadRoll = shouldProcessAsSpreadBundle && (
          isCustomSpreadSummaryRow(row) || isRollStyleSpread(bundledSpreadLegs)
        );
        let result;

        if (expiredBundleRows) {
          result = await ensurePositionExpiredWorthlessBundle({
            componentRows: expiredBundleRows,
            brokerAccountId: input.brokerAccountId,
            importBatchId: importBatch.id,
            importCurrency,
          });
        } else if (shouldProcessAsSpreadRoll && spreadComponents) {
          try {
            result = await ensurePositionRollFromSpreadSummaryRow({
              summaryRow: row,
              componentRows: spreadComponents.componentRows,
              brokerAccountId: input.brokerAccountId,
              importBatchId: importBatch.id,
              importCurrency,
            });
          } catch (error) {
            const reason = error instanceof Error ? error.message : "Unknown roll import failure";
            if (reason.startsWith("Cannot apply roll: source short contract was not found")) {
              result = await ensurePositionForRow(row, input.brokerAccountId, importBatch.id, importCurrency);
            } else {
              throw error;
            }
          }
        } else if (shouldProcessAsSpreadBundle && spreadComponents) {
          result = await ensurePositionForSpreadBundle({
            summaryRow: row,
            componentRows: spreadComponents.componentRows,
            brokerAccountId: input.brokerAccountId,
            importBatchId: importBatch.id,
            importCurrency,
          });
        } else {
          result = await ensurePositionForRow(row, input.brokerAccountId, importBatch.id, importCurrency);
        }

        if (shouldProcessAsSpreadBundle && spreadComponents) {
          for (const componentRow of spreadComponents.componentRows) {
            consumedSpreadComponentRowNumbers.add(componentRow.rowNumber);
          }
        }

        if (expiredBundleRows) {
          for (const componentRow of expiredBundleRows) {
            consumedExpiredBundleRowNumbers.add(componentRow.rowNumber);
          }
        }

        positionsCreated += result.positionCreated;
        positionActionsCreated += result.positionActionCreated;
        cashLedgerEntriesCreated += result.cashLedgerEntriesCreated;
      }

      importedRows += 1;
    } catch (error) {
      failedRows += 1;
      const reason = error instanceof Error ? error.message : "Unknown import failure";
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

