import { HoldingEventType } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "../../../../../../lib/auth";
import { deleteCashLedgerEntriesForHoldingEvent, syncCashLedgerEntriesForHoldingEvent } from "../../../../../../lib/cash-ledger-sync";
import { calculateHoldingStateFromEvents, parseHoldingNumberInput, syncHoldingFromEvents } from "../../../../../../lib/holding-rules";
import { findOwnedHoldingForUser } from "../../../../../../lib/ownership";
import { syncHoldingPnlSnapshot } from "../../../../../../lib/pnl-snapshots";
import { prisma } from "../../../../../../lib/prisma";

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

function hasNegativeInventory(events: Array<{ eventType: string; quantity: unknown; eventTimestamp: Date; createdAt?: Date }>) {
  let remaining = 0;

  for (const event of calculateHoldingStateFromEvents(events).orderedEvents) {
    const quantity = Number(event.quantity ?? 0);

    if (["ACQUIRED", "TRANSFER_IN"].includes(event.eventType)) {
      remaining += quantity;
      continue;
    }

    if (REDUCE_EVENT_TYPES.has(event.eventType)) {
      remaining -= quantity;
    }

    if (event.eventType === "ADJUSTMENT") {
      remaining += quantity;
    }

    if (remaining < 0) {
      return true;
    }
  }

  return false;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await params;
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, `/holdings/${id}`);
  }

  const form = await req.formData();
  const intent = ((form.get("intent") as string) || "update").trim();

  const holding = await findOwnedHoldingForUser(user.id, id, {
    holdingEvents: {
      orderBy: [
        { eventTimestamp: "asc" },
        { createdAt: "asc" },
      ],
    },
  });

  if (!holding) {
    return redirectWithMessage(req, id, "error", "Holding not found.");
  }

  const event = holding.holdingEvents.find((item) => item.id === eventId);

  if (!event) {
    return redirectWithMessage(req, id, "error", "Holding event not found.");
  }

  if (event.linkedPositionActionId) {
    return redirectWithMessage(req, id, "error", "Holding events linked to a position action are locked in this UI.");
  }

  if (intent === "delete") {
    if (holding.holdingEvents.length <= 1) {
      return redirectWithMessage(req, id, "error", "A holding must keep at least one opening event. Delete the holding manually later if needed.");
    }

    await deleteCashLedgerEntriesForHoldingEvent(eventId);
    await prisma.holdingEvent.delete({ where: { id: eventId } });
    await syncHoldingFromEvents(id, prisma);
    await syncHoldingPnlSnapshot(id);

    return redirectWithMessage(req, id, "success", "Holding event deleted successfully.");
  }

  const eventType = ((form.get("eventType") as string) || "").trim();
  const eventTimestampRaw = ((form.get("eventTimestamp") as string) || "").trim();
  const quantityRaw = ((form.get("quantity") as string) || "").trim();
  const pricePerShareRaw = ((form.get("pricePerShare") as string) || "").trim();
  const feeAmountRaw = ((form.get("feeAmount") as string) || "0").trim();
  const currency = ((form.get("currency") as string) || "USD").trim();
  const notes = ((form.get("notes") as string) || "").trim();

  const quantity = parseHoldingNumberInput(quantityRaw);
  const pricePerShare = parseHoldingNumberInput(pricePerShareRaw);
  const feeAmount = parseHoldingNumberInput(feeAmountRaw) ?? 0;
  const eventTimestamp = eventTimestampRaw ? new Date(eventTimestampRaw) : new Date();

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

  const resolvedAmount = quantity !== null && pricePerShare !== null ? quantity * pricePerShare : null;

  const simulatedEvents = holding.holdingEvents.map((item) => {
    if (item.id !== eventId) {
      return item;
    }

    return {
      ...item,
      eventType,
      eventTimestamp,
      quantity: quantityRaw ? quantityRaw : null,
      createdAt: item.createdAt,
    };
  });

  if (hasNegativeInventory(simulatedEvents)) {
    return redirectWithMessage(req, id, "error", "This change would make the holding inventory go negative based on the event timeline.");
  }

  await prisma.holdingEvent.update({
    where: { id: eventId },
    data: {
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
  await syncCashLedgerEntriesForHoldingEvent(eventId);
  await syncHoldingPnlSnapshot(id);

  return redirectWithMessage(req, id, "success", "Holding event updated successfully.");
}

