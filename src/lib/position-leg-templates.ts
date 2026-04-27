export type StructuredLegMode = "single-option" | "single-stock" | "vertical-spread" | "iron-condor";
export type StructuredStrikeField =
  | "singleStrike"
  | "shortStrike"
  | "longStrike"
  | "longPutStrike"
  | "shortPutStrike"
  | "shortCallStrike"
  | "longCallStrike";

type LegType = "OPTION" | "STOCK";
type LegSide = "LONG" | "SHORT";
type OptionType = "CALL" | "PUT";

export type StructuredLegDefinition = {
  key: string;
  label: string;
  legType: LegType;
  legSide: LegSide;
  optionType?: OptionType;
  legRole: string;
  strikeField?: StructuredStrikeField;
};

export type PositionStrategyLegTemplate = {
  strategyType: string;
  label: string;
  mode: StructuredLegMode;
  legs: StructuredLegDefinition[];
};

const POSITION_STRATEGY_LEG_TEMPLATES: Record<string, PositionStrategyLegTemplate> = {
  STOCK_LONG: {
    strategyType: "STOCK_LONG",
    label: "Long Stock",
    mode: "single-stock",
    legs: [
      { key: "long-stock", label: "Long stock", legType: "STOCK", legSide: "LONG", legRole: "LONG_STOCK" },
    ],
  },
  STOCK_SHORT: {
    strategyType: "STOCK_SHORT",
    label: "Short Stock",
    mode: "single-stock",
    legs: [
      { key: "short-stock", label: "Short stock", legType: "STOCK", legSide: "SHORT", legRole: "SHORT_STOCK" },
    ],
  },
  CSP: {
    strategyType: "CSP",
    label: "Cash-Secured Put",
    mode: "single-option",
    legs: [
      { key: "short-put", label: "Short put", legType: "OPTION", legSide: "SHORT", optionType: "PUT", legRole: "SHORT_PUT", strikeField: "singleStrike" },
    ],
  },
  CC: {
    strategyType: "CC",
    label: "Covered Call",
    mode: "single-option",
    legs: [
      { key: "short-call", label: "Short call", legType: "OPTION", legSide: "SHORT", optionType: "CALL", legRole: "SHORT_CALL", strikeField: "singleStrike" },
    ],
  },
  LEAPS_CALL: {
    strategyType: "LEAPS_CALL",
    label: "LEAPS Call",
    mode: "single-option",
    legs: [
      { key: "long-call", label: "Long call", legType: "OPTION", legSide: "LONG", optionType: "CALL", legRole: "LEAPS_LONG_CALL", strikeField: "singleStrike" },
    ],
  },
  LEAPS_PUT: {
    strategyType: "LEAPS_PUT",
    label: "LEAPS Put",
    mode: "single-option",
    legs: [
      { key: "long-put", label: "Long put", legType: "OPTION", legSide: "LONG", optionType: "PUT", legRole: "LEAPS_LONG_PUT", strikeField: "singleStrike" },
    ],
  },
  LONG_CALL: {
    strategyType: "LONG_CALL",
    label: "Long Call",
    mode: "single-option",
    legs: [
      { key: "long-call", label: "Long call", legType: "OPTION", legSide: "LONG", optionType: "CALL", legRole: "LONG_CALL", strikeField: "singleStrike" },
    ],
  },
  LONG_PUT: {
    strategyType: "LONG_PUT",
    label: "Long Put",
    mode: "single-option",
    legs: [
      { key: "long-put", label: "Long put", legType: "OPTION", legSide: "LONG", optionType: "PUT", legRole: "LONG_PUT", strikeField: "singleStrike" },
    ],
  },
  SHORT_CALL: {
    strategyType: "SHORT_CALL",
    label: "Short Call",
    mode: "single-option",
    legs: [
      { key: "short-call", label: "Short call", legType: "OPTION", legSide: "SHORT", optionType: "CALL", legRole: "SHORT_CALL", strikeField: "singleStrike" },
    ],
  },
  SHORT_PUT: {
    strategyType: "SHORT_PUT",
    label: "Short Put",
    mode: "single-option",
    legs: [
      { key: "short-put", label: "Short put", legType: "OPTION", legSide: "SHORT", optionType: "PUT", legRole: "SHORT_PUT", strikeField: "singleStrike" },
    ],
  },
  BULL_CALL_SPREAD: {
    strategyType: "BULL_CALL_SPREAD",
    label: "Bull Call Spread",
    mode: "vertical-spread",
    legs: [
      { key: "long-call", label: "Long call (small)", legType: "OPTION", legSide: "LONG", optionType: "CALL", legRole: "LONG_CALL", strikeField: "longStrike" },
      { key: "short-call", label: "Short call (big)", legType: "OPTION", legSide: "SHORT", optionType: "CALL", legRole: "SHORT_CALL", strikeField: "shortStrike" },
    ],
  },
  BULL_PUT_SPREAD: {
    strategyType: "BULL_PUT_SPREAD",
    label: "Bull Put Spread",
    mode: "vertical-spread",
    legs: [
      { key: "short-put", label: "Short put (big)", legType: "OPTION", legSide: "SHORT", optionType: "PUT", legRole: "SHORT_PUT", strikeField: "shortStrike" },
      { key: "long-put", label: "Long put (small)", legType: "OPTION", legSide: "LONG", optionType: "PUT", legRole: "LONG_PUT", strikeField: "longStrike" },
    ],
  },
  BEAR_CALL_SPREAD: {
    strategyType: "BEAR_CALL_SPREAD",
    label: "Bear Call Spread",
    mode: "vertical-spread",
    legs: [
      { key: "short-call", label: "Short call (small)", legType: "OPTION", legSide: "SHORT", optionType: "CALL", legRole: "SHORT_CALL", strikeField: "shortStrike" },
      { key: "long-call", label: "Long call (big)", legType: "OPTION", legSide: "LONG", optionType: "CALL", legRole: "LONG_CALL", strikeField: "longStrike" },
    ],
  },
  BEAR_PUT_SPREAD: {
    strategyType: "BEAR_PUT_SPREAD",
    label: "Bear Put Spread",
    mode: "vertical-spread",
    legs: [
      { key: "long-put", label: "Long put (big)", legType: "OPTION", legSide: "LONG", optionType: "PUT", legRole: "LONG_PUT", strikeField: "longStrike" },
      { key: "short-put", label: "Short put (small)", legType: "OPTION", legSide: "SHORT", optionType: "PUT", legRole: "SHORT_PUT", strikeField: "shortStrike" },
    ],
  },
  IRON_CONDOR: {
    strategyType: "IRON_CONDOR",
    label: "Iron Condor",
    mode: "iron-condor",
    legs: [
      { key: "long-put", label: "Long put (small)", legType: "OPTION", legSide: "LONG", optionType: "PUT", legRole: "LONG_PUT_WING", strikeField: "longPutStrike" },
      { key: "short-put", label: "Short put (big)", legType: "OPTION", legSide: "SHORT", optionType: "PUT", legRole: "SHORT_PUT", strikeField: "shortPutStrike" },
      { key: "short-call", label: "Short Call (small)", legType: "OPTION", legSide: "SHORT", optionType: "CALL", legRole: "SHORT_CALL", strikeField: "shortCallStrike" },
      { key: "long-call", label: "Long call (big)", legType: "OPTION", legSide: "LONG", optionType: "CALL", legRole: "LONG_CALL_WING", strikeField: "longCallStrike" },
    ],
  },
};

export function getPositionStrategyLegTemplate(strategyType: string | null | undefined) {
  if (!strategyType) {
    return null;
  }

  return POSITION_STRATEGY_LEG_TEMPLATES[strategyType] ?? null;
}

export function supportsGroupedLegEditing(strategyType: string | null | undefined) {
  const template = getPositionStrategyLegTemplate(strategyType);
  return template ? template.legs.length > 1 : false;
}

export function validateStructuredStrikeOrder(
  strategyType: string,
  strikes: Partial<Record<StructuredStrikeField, number>>
) {
  switch (strategyType) {
    case "BEAR_CALL_SPREAD": {
      if (strikes.shortStrike === undefined || strikes.longStrike === undefined) {
        return null;
      }

      if (strikes.shortStrike === strikes.longStrike) {
        return "Short and long call strikes must be different.";
      }

      return strikes.shortStrike < strikes.longStrike
        ? null
        : "For a bear call spread, the short strike must be below the long strike.";
    }
    case "BULL_CALL_SPREAD": {
      if (strikes.shortStrike === undefined || strikes.longStrike === undefined) {
        return null;
      }

      if (strikes.shortStrike === strikes.longStrike) {
        return "Short and long call strikes must be different.";
      }

      return strikes.longStrike < strikes.shortStrike
        ? null
        : "For a bull call spread, the long strike must be below the short strike.";
    }
    case "BULL_PUT_SPREAD": {
      if (strikes.shortStrike === undefined || strikes.longStrike === undefined) {
        return null;
      }

      if (strikes.shortStrike === strikes.longStrike) {
        return "Short and long put strikes must be different.";
      }

      return strikes.shortStrike > strikes.longStrike
        ? null
        : "For a bull put spread, the short strike must be above the long strike.";
    }
    case "BEAR_PUT_SPREAD": {
      if (strikes.shortStrike === undefined || strikes.longStrike === undefined) {
        return null;
      }

      if (strikes.shortStrike === strikes.longStrike) {
        return "Short and long put strikes must be different.";
      }

      return strikes.longStrike > strikes.shortStrike
        ? null
        : "For a bear put spread, the long strike must be above the short strike.";
    }
    case "IRON_CONDOR": {
      const { longPutStrike, shortPutStrike, shortCallStrike, longCallStrike } = strikes;
      if (
        longPutStrike === undefined ||
        shortPutStrike === undefined ||
        shortCallStrike === undefined ||
        longCallStrike === undefined
      ) {
        return null;
      }

      return longPutStrike < shortPutStrike && shortPutStrike < shortCallStrike && shortCallStrike < longCallStrike
        ? null
        : "Iron condor strikes must follow: long put < short put < short call < long call.";
    }
    default:
      return null;
  }
}

export function getTemplateLegSummary(template: PositionStrategyLegTemplate) {
  return template.legs.map((leg) => leg.label).join(" + ");
}

