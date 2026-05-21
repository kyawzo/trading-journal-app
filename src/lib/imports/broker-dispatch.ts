import { BrokerCode, type BrokerAccount, type Broker } from "@prisma/client";
import { importMoomooCsv, type ImportMoomooCsvResult } from "@/src/lib/moomoo-import/importer";
import { parseMoomooCsvPreview } from "@/src/lib/moomoo-import/parser";
import { importTigerCsv } from "@/src/lib/tiger-import/importer";
import { parseTigerCsvPreview } from "@/src/lib/tiger-import/parser";

type BrokerAccountWithBroker = BrokerAccount & {
  broker: Broker;
};

type PreviewInput = {
  brokerAccount: BrokerAccountWithBroker;
  fileName: string;
  csvText: string;
};

type CommitInput = PreviewInput;

export type BrokerCsvPreview = {
  columns: string[];
  missingRequiredColumns: string[];
  summary: {
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
  rows: Array<{
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
    skipReason: string | null;
  }>;
  warnings: string[];
};
export type BrokerCsvCommitResult = ImportMoomooCsvResult;

type BrokerImportAdapter = {
  brokerCode: BrokerCode;
  displayName: string;
  previewDescription: string;
  previewImplemented: boolean;
  commitImplemented: boolean;
  preview?: (input: PreviewInput) => Promise<BrokerCsvPreview> | BrokerCsvPreview;
  commit?: (input: CommitInput) => Promise<BrokerCsvCommitResult>;
};

const BROKER_IMPORT_ADAPTERS: Record<BrokerCode, BrokerImportAdapter> = {
  [BrokerCode.MOOMOO]: {
    brokerCode: BrokerCode.MOOMOO,
    displayName: "MooMoo",
    previewDescription: "Preview validates your MooMoo CSV and shows what would be imported before any records are written.",
    previewImplemented: true,
    commitImplemented: true,
    preview: ({ csvText }) => parseMoomooCsvPreview(csvText),
    commit: ({ brokerAccount, fileName, csvText }) => importMoomooCsv({
      brokerAccountId: brokerAccount.id,
      fileName,
      csvText,
    }),
  },
  [BrokerCode.TIGER]: {
    brokerCode: BrokerCode.TIGER,
    displayName: "Tiger",
    previewDescription: "Preview validates your Tiger statement trades, removes duplicate companion rows, and shows the holdings/options rows we can normalize before any records are written. Current commit scope imports stock holdings, single-leg options, basic same-timestamp spreads/iron condors, and basic same-timestamp roll groups.",
    previewImplemented: true,
    commitImplemented: true,
    preview: ({ csvText }) => parseTigerCsvPreview(csvText),
    commit: ({ brokerAccount, fileName, csvText }) => importTigerCsv({
      brokerAccountId: brokerAccount.id,
      fileName,
      csvText,
    }),
  },
  [BrokerCode.IBKR]: {
    brokerCode: BrokerCode.IBKR,
    displayName: "IBKR",
    previewDescription: "IBKR CSV support is not implemented yet.",
    previewImplemented: false,
    commitImplemented: false,
  },
  [BrokerCode.TASTYTRADE]: {
    brokerCode: BrokerCode.TASTYTRADE,
    displayName: "Tastytrade",
    previewDescription: "Tastytrade CSV support is not implemented yet.",
    previewImplemented: false,
    commitImplemented: false,
  },
  [BrokerCode.WEBULL]: {
    brokerCode: BrokerCode.WEBULL,
    displayName: "Webull",
    previewDescription: "Webull CSV support is not implemented yet.",
    previewImplemented: false,
    commitImplemented: false,
  },
  [BrokerCode.MANUAL]: {
    brokerCode: BrokerCode.MANUAL,
    displayName: "Manual",
    previewDescription: "Manual broker accounts do not support CSV import.",
    previewImplemented: false,
    commitImplemented: false,
  },
  [BrokerCode.OTHER]: {
    brokerCode: BrokerCode.OTHER,
    displayName: "Other",
    previewDescription: "This broker does not have a CSV adapter yet.",
    previewImplemented: false,
    commitImplemented: false,
  },
};

export function getBrokerImportAdapter(brokerCode: BrokerCode) {
  return BROKER_IMPORT_ADAPTERS[brokerCode];
}

export async function previewBrokerCsv(input: PreviewInput) {
  const adapter = getBrokerImportAdapter(input.brokerAccount.broker.brokerCode);
  if (!adapter?.previewImplemented || !adapter.preview) {
    throw new Error(`${adapter?.displayName ?? "This broker"} CSV preview is not implemented yet.`);
  }

  return adapter.preview(input);
}

export async function commitBrokerCsv(input: CommitInput) {
  const adapter = getBrokerImportAdapter(input.brokerAccount.broker.brokerCode);
  if (!adapter?.commitImplemented || !adapter.commit) {
    throw new Error(`${adapter?.displayName ?? "This broker"} CSV import is not implemented yet.`);
  }

  return adapter.commit(input);
}
