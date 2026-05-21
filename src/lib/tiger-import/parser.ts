import { normalizeTigerTradeRows, type TigerNormalizationResult } from "./normalize";

export type TigerCsvPreview = TigerNormalizationResult;

export function parseTigerCsvPreview(csvText: string): TigerCsvPreview {
  return normalizeTigerTradeRows(csvText);
}
