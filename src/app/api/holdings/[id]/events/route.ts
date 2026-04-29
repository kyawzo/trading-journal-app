import { HoldingEventType } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "../../../../../lib/auth";
import { syncCashLedgerEntriesForHoldingEvent } from "../../../../../lib/cash-ledger-sync";
import { parseHoldingNumberInput, syncHoldingFromEvents } from "../../../../../lib/holding-rules";
import { findOwnedHoldingForUser } from "../../../../../lib/ownership";
import { syncHoldingPnlSnapshot } from "../../../../../lib/pnl-snapshots";
import { prisma } from "../../../../../lib/prisma";

const QUANTITY_REQUIRED_EVENT_TYPES = new Set([
  "ACQUIRED",
  "SOLD",
  "PARTIAL_SELL",
  "CALLED_AWAY",
  "TRANSFER_IN",
  "TRANSFER_OUT",
]);

const PRICE_REQUIRED_EVENT_TYPES = new Set([
  "ACQUIRED",
  "SOLD",
  "PARTIAL_SELL",
  "CALLED_AWAY",
]);

const REDUCE_EVENT_TYPES = new Set(["SOLD", "PARTIAL_SELL", "CALLED_AWAY", "TRANSFER_OUT"]);

function redirectWithMessage(req: Request, id: string, tone: "success" | "error", message: string) {
  const url = new URL(`/holdings/${id}`, req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);
  return NextResponse.redirect(url);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, `/holdings/${id}`);
  }

  const form = await req.formData();

  const eventType = ((form.get("eventType") as string) || "").trim();
  const eventTimestampRaw = ((form.get("eventTimestamp") as string) || "").trim();
  const quantityRaw = ((form.get("quantity") as string) || "").trim();
  const pricePerShareRaw = ((form.get("pricePerShare") as string) || "").trim();
  const feeAmountRaw = ((form.get("feeAmount") as string) || "0").trim();
  const notes = ((form.get("notes") as string) || "").trim();

  const quantity = parseHoldingNumberInput(quantityRaw);
  const pricePerShare = parseHoldingNumberInput(pricePerShareRaw);
  const feeAmount = parseHoldingNumberInput(feeAmountRaw) ?? 0;
  const eventTimestamp = eventTimestampRaw ? new Date(eventTimestampRaw) : new Date();

  const holding = await findOwnedHoldingForUser(user.id, id, {
    brokerAccount: true,
  });
  if (!holding) {
    return redirectWithMessage(req, id, "error", "Holding not found.");
  }
  const currency = holding.brokerAccount?.baseCurrency ?? "USD";

  if (!eventType) {
    return redirectWithMessage(req, id, "error", "Event type is required.");
  }

  if (Number.isNaN(eventTimestamp.getTime())) {
    return redirectWithMessage(req, id, "error", "Event timestamp is invalid.");
  }

  if (QUANTITY_REQUIRED_EVENT_TYPES.has(eventType) && (quantity === null || quantity <= 0)) {
    return redirectWithMessage(req, id, "error", "Quantity must be greater than zero for this event type.");
  }

  if (eventType === "ADJUSTMENT" && quantityRaw && quantity === null) {
    return redirectWithMessage(req, id, "error", "Adjustment quantity must be a valid number when provided.");
  }

  if (PRICE_REQUIRED_EVENT_TYPES.has(eventType) && (pricePerShare === null || pricePerShare < 0)) {
    return redirectWithMessage(req, id, "error", "Price per share is required for this event type.");
  }

  if (pricePerShareRaw && (pricePerShare === null || pricePerShare < 0)) {
    return redirectWithMessage(req, id, "error", "Price per share must be zero or greater.");
  }

  if (feeAmount < 0) {
    return redirectWithMessage(req, id, "error", "Fee amount cannot be negative.");
  }

  if (REDUCE_EVENT_TYPES.has(eventType) && quantity !== null) {
    const remainingShares = Number(holding.remainingQuantity.toString());
    if (quantity > remainingShares) {
      return redirectWithMessage(req, id, "error", "This event would reduce more shares than the holding currently has remaining.");
    }
  }

  const resolvedAmount = quantity !== null && pricePerShare !== null ? quantity * pricePerShare : null;

  const createdEvent = await prisma.holdingEvent.create({
    data: {
      holdingId: id,
      eventTimestamp,
      eventType: eventType as HoldingEventType,
      quantity: quantityRaw ? quantityRaw : null,
      pricePerShare: pricePerShareRaw ? pricePerShareRaw : null,
      amount: resolvedAmount !== null ? resolvedAmount.toString() : null,
      feeAmount: feeAmount.toString(),
      currency,
      notes: notes || null,
    },
  });

  await syncHoldingFromEvents(id, prisma);
  await syncCashLedgerEntriesForHoldingEvent(createdEvent.id);
  await syncHoldingPnlSnapshot(id);

  return redirectWithMessage(req, id, "success", "Holding event added successfully.");
}
