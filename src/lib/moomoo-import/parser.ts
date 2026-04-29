const REQUIRED_COLUMNS = ["status", "markets", "symbol", "side"] as const;

const HEADER_ALIASES: Record<string, string[]> = {
  status: ["status"],
  markets: ["markets", "market"],
  symbol: ["symbol", "ticker"],
  name: ["name"],
  side: ["side"],
  orderTime: ["ordertime", "time", "orderplacedtime"],
  fillTime: ["filltime", "filledtime", "tradetime"],
  fillQty: ["fillqty", "filledqty", "fillquantity", "filledquantity"],
  fillPrice: ["fillprice", "filledprice"],
  fillAmount: ["fillamount", "filledamount", "filledvalue", "fillednotional"],
  orderQty: ["orderqty", "qty", "quantity"],
  orderAmount: ["orderamount", "amount", "notional"],
  orderPrice: ["orderprice", "price"],
  filledAvg: ["filledavgprice", "filled@avgprice", "filledatavgprice"],
  total: ["total"],
  orderSource: ["ordersource", "source"],
  currency: ["currency", "curr", "ccy"],
};

const FEE_HEADERS = new Set([
  "commission",
  "platformfees",
  "tradingfees",
  "clearingfees",
  "consumptiontax",
  "settlementfees",
  "secfees",
  "tradingactivityfees",
  "occfees",
  "optionsettlementfees",
]);

export type ImportSkipReason = "STATUS_NOT_FILLED" | "MARKET_NOT_US" | "INVALID_ROW";

export type MoomooPreviewRow = {
  rowNumber: number;
  status: string;
  market: string;
  side: string;
  symbol: string;
  underlyingSymbol: string;
  name: string;
  isOption: boolean;
  isSpread: boolean;
  assetType: "HOLDING" | "POSITION";
  quantity: number | null;
  price: number | null;
  amount: number | null;
  feeAmount: number;
  orderSource: string;
  orderTimestamp: string | null;
  fillTimestamp: string | null;
  eventTimestamp: string | null;
  skipReason: ImportSkipReason | null;
};

export type MoomooPreviewSummary = {
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

export type MoomooCsvPreview = {
  columns: string[];
  missingRequiredColumns: string[];
  summary: MoomooPreviewSummary;
  rows: MoomooPreviewRow[];
  warnings: string[];
};

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

      const hasAnyValue = row.some((value) => value.trim().length > 0);
      if (hasAnyValue) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    const hasAnyValue = row.some((value) => value.trim().length > 0);
    if (hasAnyValue) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return { headers: [] as string[], records: [] as string[][] };
  }

  const headers = rows[0];
  const records = rows.slice(1).map((columns) => headers.map((_, index) => columns[index]?.trim() ?? ""));

  return { headers, records };
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

function parseFilledAvg(value: string | undefined) {
  if (!value) {
    return { qty: null as number | null, price: null as number | null };
  }

  const [qtyPart, pricePart] = value.split("@");
  return {
    qty: parseNumber(qtyPart),
    price: parseNumber(pricePart),
  };
}

function resolveFilledQuantity(input: {
  orderQty: number | null;
  fillQty: number | null;
  filledAvgQty: number | null;
  allowOrderQtyFallback: boolean;
}) {
  const { orderQty, fillQty, filledAvgQty, allowOrderQtyFallback } = input;
  const candidates = [fillQty, filledAvgQty, ...(allowOrderQtyFallback ? [orderQty] : [])]
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);

  if (candidates.length === 0) {
    return null;
  }

  if (fillQty !== null && filledAvgQty !== null) {
    const mismatch = Math.abs(fillQty - filledAvgQty) > 0.000001;
    if (mismatch) {
      return Math.max(fillQty, filledAvgQty, orderQty ?? 0);
    }
  }

  return fillQty ?? filledAvgQty ?? orderQty;
}

function resolveFilledAmount(input: {
  fillAmount: number | null;
  fillQtyRaw: number | null;
  resolvedQty: number | null;
  resolvedPrice: number | null;
  orderAmount: number | null;
  allowOrderAmountFallback: boolean;
}) {
  const { fillAmount, fillQtyRaw, resolvedQty, resolvedPrice, orderAmount, allowOrderAmountFallback } = input;
  const hasQtyMismatch = (
    fillQtyRaw !== null &&
    resolvedQty !== null &&
    Math.abs(fillQtyRaw - resolvedQty) > 0.000001
  );

  if (hasQtyMismatch && resolvedQty !== null && resolvedPrice !== null) {
    return resolvedQty * resolvedPrice;
  }

  if (fillAmount !== null) {
    return fillAmount;
  }

  if (resolvedQty !== null && resolvedPrice !== null) {
    return resolvedQty * resolvedPrice;
  }

  if (allowOrderAmountFallback && orderAmount !== null) {
    return orderAmount;
  }

  return null;
}

function parseMoomooDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsedNative = Date.parse(trimmed);
  if (!Number.isNaN(parsedNative)) {
    return new Date(parsedNative).toISOString();
  }

  const match = trimmed.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+([A-Za-z]{2,4})$/);
  if (!match) {
    return null;
  }

  const [, mon, day, year, hour, min, sec, timezone] = match;
  const monthMap: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  const tzOffsetHours: Record<string, number> = {
    ET: -5,
    EST: -5,
    EDT: -4,
    CT: -6,
    CST: -6,
    CDT: -5,
    MT: -7,
    MST: -7,
    MDT: -6,
    PT: -8,
    PST: -8,
    PDT: -7,
    UTC: 0,
    GMT: 0,
  };

  const monthIndex = monthMap[mon];
  if (monthIndex === undefined) {
    return null;
  }

  const offset = tzOffsetHours[timezone.toUpperCase()] ?? -5;
  const utcMillis = Date.UTC(
    Number(year),
    monthIndex,
    Number(day),
    Number(hour),
    Number(min),
    Number(sec),
  ) - offset * 60 * 60 * 1000;

  return new Date(utcMillis).toISOString();
}

function detectOptionSymbol(symbol: string) {
  return /^([A-Z]+)\d{6}([CP])(\d+)$/.test(symbol);
}

function extractUnderlyingSymbol(symbol: string, isOption: boolean, isSpread: boolean) {
  if (isOption) {
    const match = symbol.match(/^([A-Z]+)\d{6}[CP]\d+$/);
    return match?.[1] ?? symbol;
  }

  if (isSpread) {
    const spreadMatch = symbol.match(/^([A-Z]+)\d/);
    if (spreadMatch?.[1]) {
      return spreadMatch[1];
    }

    const slashIndex = symbol.indexOf("/");
    if (slashIndex > 0) {
      return symbol.slice(0, slashIndex).replace(/[^A-Z]/g, "") || symbol;
    }
  }

  return symbol;
}

function getMappedValue(record: string[], headerLookup: Record<string, number[]>, key: keyof typeof HEADER_ALIASES) {
  const indices = headerLookup[key] ?? [];
  if (indices.length === 0) {
    return undefined;
  }

  for (const index of indices) {
    const value = record[index];
    if (value?.trim()) {
      return value;
    }
  }

  return record[indices[0]];
}

function buildHeaderLookup(headers: string[]) {
  const lookup: Record<string, number[]> = {};
  Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
    lookup[field] = headers
      .map((header, index) => ({ normalized: normalizeHeader(header), index }))
      .filter((entry) => aliases.includes(entry.normalized))
      .map((entry) => entry.index);
  });

  return lookup;
}

function getPrimaryHeaderIndex(headerLookup: Record<string, number[]>, key: keyof typeof HEADER_ALIASES) {
  return headerLookup[key]?.[0] ?? -1;
}

function mergeMoomooContinuationRecords(records: string[][], headerLookup: Record<string, number[]>) {
  const symbolIndex = getPrimaryHeaderIndex(headerLookup, "symbol");
  const sideIndex = getPrimaryHeaderIndex(headerLookup, "side");
  const fillQtyIndex = getPrimaryHeaderIndex(headerLookup, "fillQty");
  const fillPriceIndex = getPrimaryHeaderIndex(headerLookup, "fillPrice");
  const fillAmountIndex = getPrimaryHeaderIndex(headerLookup, "fillAmount");
  const filledAvgIndex = getPrimaryHeaderIndex(headerLookup, "filledAvg");

  if (symbolIndex < 0 || sideIndex < 0) {
    return records;
  }

  const mergedRecords: string[][] = [];

  for (const record of records) {
    const symbol = record[symbolIndex]?.trim() ?? "";
    const side = record[sideIndex]?.trim() ?? "";
    const isContinuation = symbol.length === 0 && side.length === 0 && mergedRecords.length > 0;

    if (!isContinuation) {
      mergedRecords.push([...record]);
      continue;
    }

    const target = mergedRecords[mergedRecords.length - 1];
    if (!target) {
      mergedRecords.push([...record]);
      continue;
    }

    const targetQty = fillQtyIndex >= 0 ? parseNumber(target[fillQtyIndex]) ?? 0 : 0;
    const targetAmount = fillAmountIndex >= 0 ? parseNumber(target[fillAmountIndex]) ?? 0 : 0;
    const targetPrice = fillPriceIndex >= 0 ? parseNumber(target[fillPriceIndex]) : null;

    const rowQty = fillQtyIndex >= 0 ? parseNumber(record[fillQtyIndex]) ?? 0 : 0;
    const rowAmount = fillAmountIndex >= 0 ? parseNumber(record[fillAmountIndex]) ?? 0 : 0;
    const rowPrice = fillPriceIndex >= 0 ? parseNumber(record[fillPriceIndex]) : null;

    const mergedQty = targetQty + rowQty;
    const mergedAmount = targetAmount + rowAmount;
    const mergedPrice = mergedQty > 0
      ? mergedAmount / mergedQty
      : rowPrice ?? targetPrice;

    if (fillQtyIndex >= 0 && mergedQty > 0) {
      target[fillQtyIndex] = mergedQty.toString();
    }

    if (fillAmountIndex >= 0 && mergedAmount > 0) {
      target[fillAmountIndex] = mergedAmount.toString();
    }

    if (fillPriceIndex >= 0 && mergedPrice !== null && Number.isFinite(mergedPrice)) {
      target[fillPriceIndex] = mergedPrice.toString();
    }

    if (filledAvgIndex >= 0 && mergedQty > 0 && mergedPrice !== null && Number.isFinite(mergedPrice)) {
      target[filledAvgIndex] = `${mergedQty}@${mergedPrice}`;
    }
  }

  return mergedRecords;
}

function calculateFeeAmount(record: string[], headers: string[], headerLookup: Record<string, number[]>) {
  const totalValue = getMappedValue(record, headerLookup, "total");
  const parsedTotal = parseNumber(totalValue);
  if (parsedTotal !== null) {
    return Math.abs(parsedTotal);
  }

  let feeTotal = 0;
  let hasExplicitFee = false;

  headers.forEach((header, index) => {
    if (!FEE_HEADERS.has(normalizeHeader(header))) {
      return;
    }
    const parsed = parseNumber(record[index]);
    if (parsed !== null) {
      feeTotal += parsed;
      hasExplicitFee = true;
    }
  });

  if (hasExplicitFee) {
    return feeTotal;
  }

  return 0;
}

export function parseMoomooCsvPreview(csvText: string): MoomooCsvPreview {
  const { headers, records: rawRecords } = parseCsvText(csvText);
  const headerLookup = buildHeaderLookup(headers);
  const records = mergeMoomooContinuationRecords(rawRecords, headerLookup);
  const missingRequiredColumns = REQUIRED_COLUMNS.filter((column) => (headerLookup[column] ?? []).length === 0);
  const warnings: string[] = [];
  const rows: MoomooPreviewRow[] = [];

  let processableRows = 0;
  let holdingsRows = 0;
  let positionRows = 0;
  let optionRows = 0;
  let spreadRows = 0;
  let skippedStatusRows = 0;
  let skippedNonUsRows = 0;
  let skippedInvalidRows = 0;
  const holdingSymbols = new Set<string>();
  const detectedCurrencies = new Set<string>();

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const rawStatus = (getMappedValue(record, headerLookup, "status") ?? "").trim().toUpperCase();
    const market = (getMappedValue(record, headerLookup, "markets") ?? "").trim().toUpperCase();
    const side = (getMappedValue(record, headerLookup, "side") ?? "").trim().toUpperCase();
    const symbol = (getMappedValue(record, headerLookup, "symbol") ?? "").trim().toUpperCase();
    const name = (getMappedValue(record, headerLookup, "name") ?? "").trim();
    const orderSource = (getMappedValue(record, headerLookup, "orderSource") ?? "").trim();
    const currency = (getMappedValue(record, headerLookup, "currency") ?? "").trim().toUpperCase();
    const orderQty = parseNumber(getMappedValue(record, headerLookup, "orderQty"));
    const orderAmount = parseNumber(getMappedValue(record, headerLookup, "orderAmount"));
    const orderPrice = parseNumber(getMappedValue(record, headerLookup, "orderPrice"));

    const filledAvg = parseFilledAvg(getMappedValue(record, headerLookup, "filledAvg"));
    const fillQtyRaw = parseNumber(getMappedValue(record, headerLookup, "fillQty"));
    const fillAmountRaw = parseNumber(getMappedValue(record, headerLookup, "fillAmount"));
    const hasFillSignal = (
      (fillQtyRaw !== null && fillQtyRaw > 0) ||
      (filledAvg.qty !== null && filledAvg.qty > 0) ||
      (fillAmountRaw !== null && Math.abs(fillAmountRaw) > 0)
    );
    const inferredFilled = rawStatus.length === 0 && hasFillSignal;
    const status = inferredFilled ? "FILLED" : rawStatus;
    const fillQty = resolveFilledQuantity({
      orderQty,
      fillQty: fillQtyRaw,
      filledAvgQty: filledAvg.qty,
      allowOrderQtyFallback: status === "FILLED",
    });
    const fillPrice = parseNumber(getMappedValue(record, headerLookup, "fillPrice"))
      ?? filledAvg.price
      ?? orderPrice;
    const fillAmount = resolveFilledAmount({
      fillAmount: fillAmountRaw,
      fillQtyRaw,
      resolvedQty: fillQty,
      resolvedPrice: fillPrice,
      orderAmount,
      allowOrderAmountFallback: status === "FILLED",
    });
    const feeAmount = calculateFeeAmount(record, headers, headerLookup);

    const fillTime = getMappedValue(record, headerLookup, "fillTime");
    const orderTime = getMappedValue(record, headerLookup, "orderTime");
    const fillTimestamp = parseMoomooDate(fillTime);
    const orderTimestamp = parseMoomooDate(orderTime);
    const eventTimestamp = fillTimestamp ?? orderTimestamp;

    let skipReason: ImportSkipReason | null = null;
    if (status !== "FILLED") {
      skipReason = "STATUS_NOT_FILLED";
      skippedStatusRows += 1;
    } else if (market !== "US") {
      skipReason = "MARKET_NOT_US";
      skippedNonUsRows += 1;
    }

    const isSpread = symbol.includes("/") || name.includes("/");
    const isOption = detectOptionSymbol(symbol);
    const assetType: "HOLDING" | "POSITION" = isOption || isSpread ? "POSITION" : "HOLDING";
    const underlyingSymbol = extractUnderlyingSymbol(symbol, isOption, isSpread);

    if (!symbol || !side) {
      skipReason = "INVALID_ROW";
      skippedInvalidRows += 1;
      warnings.push(`Row ${rowNumber}: missing required symbol or side value.`);
    }

    if (status === "FILLED" && !eventTimestamp) {
      warnings.push(`Row ${rowNumber}: unable to parse trade timestamp, default timestamping may be required during import.`);
    }

    if (skipReason === null) {
      processableRows += 1;
      if (currency) {
        detectedCurrencies.add(currency);
      }

      if (assetType === "HOLDING") {
        holdingsRows += 1;
        holdingSymbols.add(underlyingSymbol);
      } else {
        positionRows += 1;
      }

      if (isOption) {
        optionRows += 1;
      }

      if (isSpread) {
        spreadRows += 1;
      }
    }

    rows.push({
      rowNumber,
      status,
      market,
      side,
      symbol,
      underlyingSymbol,
      name,
      isOption,
      isSpread,
      assetType,
      quantity: fillQty,
      price: fillPrice,
      amount: fillAmount,
      feeAmount,
      orderSource,
      orderTimestamp,
      fillTimestamp,
      eventTimestamp,
      skipReason,
    });
  });

  return {
    columns: headers,
    missingRequiredColumns,
    summary: {
      totalRows: records.length,
      processableRows,
      holdingsRows,
      positionRows,
      optionRows,
      spreadRows,
      holdingSymbolsCount: holdingSymbols.size,
      skippedStatusRows,
      skippedNonUsRows,
      skippedInvalidRows,
      detectedCurrencies: [...detectedCurrencies].sort(),
    },
    rows,
    warnings,
  };
}
