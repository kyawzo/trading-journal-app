import assert from "node:assert/strict";
import test from "node:test";
import { parseMoomooCsvPreview } from "../src/lib/moomoo-import/parser";

test("parseMoomooCsvPreview counts processable, skipped, and grouped rows", () => {
  const csv = [
    "Status,Markets,Side,Symbol,Name,Fill Qty,Fill Price,Fill Amount,Fill Time,Commission,Platform Fees",
    "Filled,US,Buy,RGTI,Rigetti Computing,50,19.25,962.5,\"Apr 17, 2026 10:51:28 ET\",0.99,0.25",
    "Filled,US,Sell,RGTI,Rigetti Computing,25,20.5,512.5,\"Apr 18, 2026 10:51:28 ET\",0.99,0.25",
    "Cancelled,US,Buy,SPXW260430C7290000,SPX Call,1,3.25,325,\"Apr 18, 2026 12:01:00 ET\",1.2,0",
    "Filled,SG,Buy,OV8,SG Counter,10,1.2,12,\"Apr 19, 2026 09:00:00 ET\",0,0",
    "Filled,US,Sell,SPXW260430C7290000,SPX Call,1,2.1,210,\"Apr 20, 2026 11:05:00 ET\",1.2,0",
  ].join("\n");

  const preview = parseMoomooCsvPreview(csv);

  assert.equal(preview.missingRequiredColumns.length, 0);
  assert.equal(preview.summary.totalRows, 5);
  assert.equal(preview.summary.processableRows, 3);
  assert.equal(preview.summary.holdingsRows, 2);
  assert.equal(preview.summary.positionRows, 1);
  assert.equal(preview.summary.optionRows, 1);
  assert.equal(preview.summary.holdingSymbolsCount, 1);
  assert.equal(preview.summary.skippedStatusRows, 1);
  assert.equal(preview.summary.skippedNonUsRows, 1);
});

test("parseMoomooCsvPreview reports missing required columns", () => {
  const csv = [
    "Status,Side,Symbol",
    "Filled,Buy,AAPL",
  ].join("\n");

  const preview = parseMoomooCsvPreview(csv);

  assert.deepEqual(preview.missingRequiredColumns, ["markets"]);
});

test("parseMoomooCsvPreview handles duplicated Markets headers by using non-empty value", () => {
  const csv = [
    "Side,Symbol,Status,Markets,Fill Qty,Fill Price,Markets",
    "Buy,SPX260430C7290/7300,Filled,US,1,0.80,",
  ].join("\n");

  const preview = parseMoomooCsvPreview(csv);

  assert.equal(preview.summary.processableRows, 1);
  assert.equal(preview.summary.spreadRows, 1);
  assert.equal(preview.rows[0]?.market, "US");
  assert.equal(preview.rows[0]?.skipReason, null);
});

test("parseMoomooCsvPreview infers FILLED status for component leg rows with fill values", () => {
  const csv = [
    "Status,Markets,Side,Symbol,Name,Fill Qty,Fill Price,Fill Amount,Fill Time",
    ",US,Buy,BULL251031P12500,,1,1.83,183,\"Oct 8, 2025 10:16:40 ET\"",
    ",US,Sell,BULL260515P10000,,1,2.23,223,\"Oct 8, 2025 10:16:40 ET\"",
  ].join("\n");

  const preview = parseMoomooCsvPreview(csv);

  assert.equal(preview.summary.totalRows, 2);
  assert.equal(preview.summary.processableRows, 2);
  assert.equal(preview.summary.skippedStatusRows, 0);
  assert.equal(preview.rows[0]?.status, "FILLED");
  assert.equal(preview.rows[0]?.skipReason, null);
  assert.equal(preview.rows[1]?.status, "FILLED");
  assert.equal(preview.rows[1]?.skipReason, null);
});

test("parseMoomooCsvPreview resolves quantity using Filled@Avg when Fill Qty is partial", () => {
  const csv = [
    "Side,Symbol,Status,Markets,Order Qty,Order Price,Filled@Avg Price,Fill Qty,Fill Price,Fill Amount,Fill Time",
    "Short Sell,RR260306C6000,Filled,US,3,0.04,3@0.04,1,0.04,4.00,\"Feb 10, 2026 09:30:08 ET\"",
  ].join("\n");

  const preview = parseMoomooCsvPreview(csv);

  assert.equal(preview.summary.processableRows, 1);
  assert.equal(preview.rows[0]?.quantity, 3);
  assert.equal(preview.rows[0]?.price, 0.04);
  assert.equal(preview.rows[0]?.amount, 0.12);
});

test("parseMoomooCsvPreview does not infer filled from order qty alone on blank component rows", () => {
  const csv = [
    "Side,Symbol,Status,Markets,Order Qty,Order Price,Filled@Avg Price,Fill Qty,Fill Price,Fill Amount,Fill Time",
    "Sell,DIS251114P102000,,US,1unit(s),,,,,,",
  ].join("\n");

  const preview = parseMoomooCsvPreview(csv);

  assert.equal(preview.summary.processableRows, 0);
  assert.equal(preview.rows[0]?.skipReason, "STATUS_NOT_FILLED");
  assert.equal(preview.warnings.length, 0);
});
