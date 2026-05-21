type TigerPreviewAssetType = "HOLDING" | "POSITION";

export type TigerPreviewSkipReason = "MARKET_NOT_US" | "INVALID_ROW";

export type TigerNormalizedTradeRow = {
  rowNumber: number;
  status: string;
  market: string;
  side: string;
  symbol: string;
  underlyingSymbol: string;
  name: string;
  isOption: boolean;
  isSpread: boolean;
  assetType: TigerPreviewAssetType;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  feeAmount: number;
  orderSource: string;
  orderTimestamp: string | null;
  fillTimestamp: string | null;
  eventTimestamp: string | null;
  skipReason: TigerPreviewSkipReason | null;
  assetSubtype: "Stock" | "Option";
  activityType: string;
  exchange: string;
  rawSymbolText: string;
  currency: string;
  sourceSection: "Trades" | "Exercise and Expiration";
};

export type TigerNormalizationSummary = {
  totalRows: number;
  processableRows: number;
  holdingsRows: number;
  positionRows: number;
  optionRows: number;
  spreadRows: number;
  holdingSymbolsCount: number;
  skippedStatusRows: number;
  skippedNonUsRows: number;
  skippedInvalidRows: number;
  detectedCurrencies: string[];
};

export type TigerNormalizationResult = {
  columns: string[];
  missingRequiredColumns: string[];
  rows: TigerNormalizedTradeRow[];
  warnings: string[];
  summary: TigerNormalizationSummary;
};

const REQUIRED_TRADE_COLUMNS = [
  "symbol",
  "market",
  "activitytype",
  "quantity",
  "tradeprice",
  "amount",
  "tradetime",
  "currency",
] as const;

const REQUIRED_EXPIRY_COLUMNS = [
  "symbol",
  "transactiontype",
  "quantity",
  "datetime",
  "currency",
] as const;

const TIGER_FEE_HEADERS = new Set([
  "transactionfee",
  "othertripartitefees",
  "settlementfee",
  "secfee",
  "optionregulatoryfee",
  "stampduty",
  "transactionlevy",
  "clearingfee",
  "tradingactivityfee",
  "exchangefee",
  "futureregulatoryfee",
  "commission",
  "platformfee",
  "optionsettlementfee",
  "subscriptionfee",
  "redemptionfee",
  "switchingfee",
  "phstocktransactiontax",
  "taxservicefee",
  "afrctransactionlevy",
  "tradingtariff",
  "brokeragefee",
  "handingfee",
  "securitiesmanagementfee",
  "transferfeescsdc",
  "transferfeeshkscc",
  "stampdutyonstockborrowing",
  "consolidatedaudittrailfee",
  "processingfee",
  "cmdasifee",
  "dvpsifee",
  "ipotransactionfee",
  "ipoprocessfee",
  "iposettlefee",
  "ipochannelfee",
  "gst",
]);

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsvText(csvText: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const text = csvText.replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }

      row.push(cell);
      cell = "";

      if (row.some((value) => value.trim().length > 0)) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim().length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function parseNumber(value: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/,/g, "").replace(/[^\d.+-]/g, "");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildHeaderLookup(headers: string[]) {
  return headers.reduce<Record<string, number>>((accumulator, header, index) => {
    accumulator[normalizeHeader(header)] = index;
    return accumulator;
  }, {});
}

function getValue(record: string[], headerLookup: Record<string, number>, normalizedHeader: string) {
  const index = headerLookup[normalizedHeader];
  return index === undefined ? "" : (record[index] ?? "").trim();
}

function parseTigerTradeTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  const parsedNative = Date.parse(normalized);
  if (!Number.isNaN(parsedNative)) {
    return new Date(parsedNative).toISOString();
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2}),?\s+(\d{2}):(\d{2}):(\d{2}),\s*([A-Za-z0-9/_+\-]+)$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second, timezone] = match;
  let zoneOffsetHours = 0;
  if (timezone === "US/Eastern") {
    zoneOffsetHours = 5;
  } else {
    const gmtMatch = timezone.match(/^GMT([+-]\d{1,2})$/i);
    if (gmtMatch) {
      zoneOffsetHours = -Number(gmtMatch[1]);
    }
  }
  const utcMillis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) + zoneOffsetHours,
    Number(minute),
    Number(second),
  );

  return new Date(utcMillis).toISOString();
}

function extractSymbolTokens(symbolText: string) {
  const match = symbolText.match(/\(([A-Z.]+)(?:\s+(\d{8})\s+(PUT|CALL)\s+([\d.]+))?\)/i);
  if (!match) {
    return null;
  }

  const [, underlyingSymbol, expiryRaw, optionTypeRaw, strikeRaw] = match;
  return {
    underlyingSymbol: underlyingSymbol.toUpperCase(),
    expiryRaw: expiryRaw ?? null,
    optionTypeRaw: optionTypeRaw?.toUpperCase() ?? null,
    strikeRaw: strikeRaw ?? null,
  };
}

function buildNormalizedOptionSymbol(input: {
  underlyingSymbol: string;
  expiryRaw: string | null;
  optionTypeRaw: string | null;
  strikeRaw: string | null;
}) {
  if (!input.expiryRaw || !input.optionTypeRaw || !input.strikeRaw) {
    return input.underlyingSymbol;
  }

  return `${input.underlyingSymbol} ${input.expiryRaw} ${input.optionTypeRaw} ${input.strikeRaw}`;
}

function calculateFeeAmount(record: string[], headers: string[], headerLookup: Record<string, number>) {
  return headers.reduce((sum, header) => {
    const normalizedHeader = normalizeHeader(header);
    if (!TIGER_FEE_HEADERS.has(normalizedHeader)) {
      return sum;
    }

    return sum + Math.abs(parseNumber(getValue(record, headerLookup, normalizedHeader)) ?? 0);
  }, 0);
}

function normalizeTigerTradeRecord(record: string[], headerCount: number) {
  if (record.length === headerCount) {
    return record;
  }

  const normalized = [...record];
  const lastValue = normalized.at(-1)?.trim().toUpperCase() ?? "";
  const settleDateValue = normalized.at(-2)?.trim() ?? "";
  const tradeTimeValue = normalized.at(-3)?.trim() ?? "";
  const looksLikeCurrency = /^[A-Z]{3}$/.test(lastValue);
  const looksLikeSettleDate = /^\d{4}-\d{2}-\d{2}$/.test(settleDateValue);
  const looksLikeTradeTime = /US\/Eastern/i.test(tradeTimeValue);

  // Some Tiger stock rows contain one additional tail value before the standard
  // `GST / Realized P\/L / Notes / Trade Time / Settle Date / Currency` block.
  // Drop that extra slot so stock and option trades align to the shared trade header.
  if (
    normalized.length === headerCount + 1 &&
    looksLikeCurrency &&
    looksLikeSettleDate &&
    looksLikeTradeTime
  ) {
    normalized.splice(normalized.length - 8, 1);
    return normalized;
  }

  return normalized.slice(0, headerCount);
}

function createCompanionFingerprint(input: {
  assetSubtype: string;
  market: string;
  exchange: string;
  activityType: string;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  feeAmount: number;
  tradeTime: string;
  currency: string;
  rawSymbolText: string;
}) {
  return [
    input.assetSubtype,
    input.market,
    input.exchange,
    input.activityType,
    input.quantity ?? "",
    input.price ?? "",
    input.amount ?? "",
    input.feeAmount.toFixed(4),
    input.tradeTime,
    input.currency,
    input.rawSymbolText,
  ].join("|");
}

function inferSpreadBundleCount(rows: TigerNormalizedTradeRow[]) {
  const bundleMap = new Map<string, Set<string>>();

  for (const row of rows) {
    if (row.skipReason || !row.isOption || !row.eventTimestamp) {
      continue;
    }

    const bundleKey = `${row.underlyingSymbol}|${row.eventTimestamp}|${row.side}|${row.quantity ?? ""}`;
    const bucket = bundleMap.get(bundleKey) ?? new Set<string>();
    bucket.add(row.symbol);
    bundleMap.set(bundleKey, bucket);
  }

  let inferredSpreadBundles = 0;
  for (const contracts of bundleMap.values()) {
    if (contracts.size > 1) {
      inferredSpreadBundles += 1;
    }
  }

  return inferredSpreadBundles;
}

function tradeHeadersFromRow(row: string[]) {
  return row.slice(4);
}

export function normalizeTigerTradeRows(csvText: string): TigerNormalizationResult {
  const rows = parseCsvText(csvText);
  const warnings: string[] = [];
  const normalizedRows: TigerNormalizedTradeRow[] = [];
  const detectedCurrencies = new Set<string>();
  const holdingSymbols = new Set<string>();

  const tradesHeaderRow = rows.find((row) => row[0]?.trim() === "Trades" && row.some((value) => value.trim() === "Activity Type")) ?? null;
  const tradeHeaders = tradesHeaderRow ? tradeHeadersFromRow(tradesHeaderRow) : [];
  const headerLookup = buildHeaderLookup(tradeHeaders);
  const expiryHeaderRow = rows.find((row) => (
    row[0]?.trim() === "Exercise and Expiration" &&
    row.some((value) => value.trim() === "Transaction Type")
  )) ?? null;
  const expiryHeaders = expiryHeaderRow ? tradeHeadersFromRow(expiryHeaderRow) : [];
  const expiryHeaderLookup = buildHeaderLookup(expiryHeaders);
  const missingRequiredColumns = tradesHeaderRow
    ? REQUIRED_TRADE_COLUMNS.filter((column) => headerLookup[column] === undefined)
    : ["Trades section header"];

  if (!tradesHeaderRow || missingRequiredColumns.length > 0) {
    return {
      columns: tradeHeaders,
      missingRequiredColumns,
      rows: [],
      warnings: ["Tiger CSV trades header could not be found or is missing required columns."],
      summary: {
        totalRows: 0,
        processableRows: 0,
        holdingsRows: 0,
        positionRows: 0,
        optionRows: 0,
        spreadRows: 0,
        holdingSymbolsCount: 0,
        skippedStatusRows: 0,
        skippedNonUsRows: 0,
        skippedInvalidRows: 0,
        detectedCurrencies: [],
      },
    };
  }

  let processableRows = 0;
  let holdingsRows = 0;
  let positionRows = 0;
  let optionRows = 0;
  let skippedNonUsRows = 0;
  let skippedInvalidRows = 0;
  let previousPopulatedTradeFingerprint: string | null = null;

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const section = (row[0] ?? "").trim();
    const assetSubtype = (row[1] ?? "").trim();
    const rowKind = (row[3] ?? "").trim().toUpperCase();

    if (rowKind !== "DATA") {
      return;
    }

    let rawSymbolText = "";
    let market = "";
    let exchange = "";
    let activityType = "";
    let quantity: number | null = null;
    let price: number | null = null;
    let amount: number | null = null;
    let eventTimestamp: string | null = null;
    let feeAmount = 0;
    let currency = "";
    let underlyingSymbol = "";
    let isOption = false;
    let normalizedSymbol = "";
    let sourceSection: TigerNormalizedTradeRow["sourceSection"] | null = null;

    if (section === "Trades") {
      if (assetSubtype !== "Stock" && assetSubtype !== "Option") {
        return;
      }

      const record = normalizeTigerTradeRecord(tradeHeadersFromRow(row), tradeHeaders.length);
      rawSymbolText = getValue(record, headerLookup, "symbol");
      market = getValue(record, headerLookup, "market").toUpperCase();
      exchange = getValue(record, headerLookup, "exchange").toUpperCase();
      activityType = getValue(record, headerLookup, "activitytype").toUpperCase();
      quantity = parseNumber(getValue(record, headerLookup, "quantity"));
      price = parseNumber(getValue(record, headerLookup, "tradeprice"));
      amount = parseNumber(getValue(record, headerLookup, "amount"));
      const tradeTime = getValue(record, headerLookup, "tradetime");
      currency = getValue(record, headerLookup, "currency").toUpperCase();
      eventTimestamp = parseTigerTradeTime(tradeTime);
      feeAmount = calculateFeeAmount(record, tradeHeaders, headerLookup);
      const parsedSymbol = rawSymbolText ? extractSymbolTokens(rawSymbolText) : null;
      underlyingSymbol = parsedSymbol?.underlyingSymbol ?? "";
      isOption = assetSubtype === "Option";
      normalizedSymbol = parsedSymbol
        ? buildNormalizedOptionSymbol(parsedSymbol)
        : rawSymbolText;
      sourceSection = "Trades";
    } else if (section === "Exercise and Expiration") {
      if (assetSubtype !== "Option" || expiryHeaders.length === 0) {
        return;
      }

      const missingExpiryColumns = REQUIRED_EXPIRY_COLUMNS.filter((column) => expiryHeaderLookup[column] === undefined);
      if (missingExpiryColumns.length > 0) {
        warnings.push(`Row ${rowNumber}: Tiger Exercise and Expiration header is missing required columns: ${missingExpiryColumns.join(", ")}.`);
        skippedInvalidRows += 1;
        return;
      }

      const record = normalizeTigerTradeRecord(tradeHeadersFromRow(row), expiryHeaders.length);
      rawSymbolText = getValue(record, expiryHeaderLookup, "symbol");
      activityType = getValue(record, expiryHeaderLookup, "transactiontype").toUpperCase();
      quantity = parseNumber(getValue(record, expiryHeaderLookup, "quantity"));
      amount = parseNumber(getValue(record, expiryHeaderLookup, "cashsettlement")) ?? 0;
      price = 0;
      const dateTime = getValue(record, expiryHeaderLookup, "datetime");
      currency = getValue(record, expiryHeaderLookup, "currency").toUpperCase();
      eventTimestamp = parseTigerTradeTime(dateTime);
      feeAmount = 0;
      market = "US";
      exchange = "";
      const parsedSymbol = rawSymbolText ? extractSymbolTokens(rawSymbolText) : null;
      underlyingSymbol = parsedSymbol?.underlyingSymbol ?? "";
      isOption = true;
      normalizedSymbol = parsedSymbol
        ? buildNormalizedOptionSymbol(parsedSymbol)
        : rawSymbolText;
      sourceSection = "Exercise and Expiration";
    } else {
      return;
    }

    const companionFingerprint = createCompanionFingerprint({
      assetSubtype,
      market,
      exchange,
      activityType,
      quantity,
      price,
      amount,
      feeAmount,
      tradeTime: eventTimestamp ?? "",
      currency,
      rawSymbolText,
    });

    let skipReason: TigerPreviewSkipReason | null = null;

    if (sourceSection === "Exercise and Expiration" && activityType !== "OPTION EXPIRE") {
      skipReason = "INVALID_ROW";
      skippedInvalidRows += 1;
      warnings.push(`Row ${rowNumber}: Tiger exercise transaction type ${activityType || "N/A"} is not supported yet.`);
    } else if (market !== "US") {
      skipReason = "MARKET_NOT_US";
      skippedNonUsRows += 1;
    } else if (!activityType || quantity === null || price === null || amount === null || !currency) {
      skipReason = "INVALID_ROW";
      skippedInvalidRows += 1;
      warnings.push(`Row ${rowNumber}: missing Tiger trade fields required for preview.`);
    } else if (!rawSymbolText) {
      // Tiger often exports a duplicate companion row with the same economics but a blank symbol cell.
      // Keep the richer populated-symbol row and drop the blank-symbol companion so later imports do not double-book trades.
      if (previousPopulatedTradeFingerprint === companionFingerprint) {
        skipReason = "INVALID_ROW";
        skippedInvalidRows += 1;
        warnings.push(`Row ${rowNumber}: skipped duplicate Tiger companion row with blank symbol.`);
      } else {
        skipReason = "INVALID_ROW";
        skippedInvalidRows += 1;
        warnings.push(`Row ${rowNumber}: blank Tiger symbol row could not be matched to a companion trade row.`);
      }
    } else if (!underlyingSymbol) {
      skipReason = "INVALID_ROW";
      skippedInvalidRows += 1;
      warnings.push(`Row ${rowNumber}: unable to extract underlying symbol from Tiger symbol text.`);
    }

    if (rawSymbolText) {
      previousPopulatedTradeFingerprint = companionFingerprint;
    }

    if (skipReason === null) {
      processableRows += 1;
      detectedCurrencies.add(currency);

      if (isOption) {
        positionRows += 1;
        optionRows += 1;
      } else {
        holdingsRows += 1;
        holdingSymbols.add(underlyingSymbol);
      }
    }

    normalizedRows.push({
      rowNumber,
      status: "FILLED",
      market,
      side: activityType,
      symbol: normalizedSymbol || rawSymbolText || "N/A",
      underlyingSymbol: underlyingSymbol || "N/A",
      name: rawSymbolText,
      isOption,
      isSpread: false,
      assetType: isOption ? "POSITION" : "HOLDING",
      quantity,
      price,
      amount,
      feeAmount,
      orderSource: "TIGER_STATEMENT",
      orderTimestamp: eventTimestamp,
      fillTimestamp: eventTimestamp,
      eventTimestamp,
      skipReason,
      assetSubtype: isOption ? "Option" : "Stock",
      activityType,
      exchange,
      rawSymbolText,
      currency,
      sourceSection: sourceSection ?? "Trades",
    });
  });

  const spreadRows = inferSpreadBundleCount(normalizedRows);

  return {
    columns: tradeHeaders,
    missingRequiredColumns: [],
    rows: normalizedRows,
    warnings,
    summary: {
      totalRows: normalizedRows.length,
      processableRows,
      holdingsRows,
      positionRows,
      optionRows,
      spreadRows,
      holdingSymbolsCount: holdingSymbols.size,
      skippedStatusRows: 0,
      skippedNonUsRows,
      skippedInvalidRows,
      detectedCurrencies: [...detectedCurrencies].sort(),
    },
  };
}
