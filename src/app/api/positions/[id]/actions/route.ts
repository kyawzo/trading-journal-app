import { ActionEffectType, DisciplineRating, HoldingEventType, HoldingSourceType, HoldingStatus, PositionActionType, PositionStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "../../../../../lib/auth";
import { syncCashLedgerEntriesForHoldingEvent, syncCashLedgerEntriesForPositionAction } from "../../../../../lib/cash-ledger-sync";
import { findOwnedPositionForUser } from "../../../../../lib/ownership";
import { syncHoldingPnlSnapshot, syncPositionPnlSnapshot } from "../../../../../lib/pnl-snapshots";
import { prisma } from "../../../../../lib/prisma";

type RouteProps = {
  params: Promise<{ id: string }>;
};

function inferActionEffect(actionType: string): string {
  switch (actionType) {
    case "STO":
    case "BTO":
      return "OPEN";
    case "BTC":
    case "STC":
      return "CLOSE";
    case "ROLL_CREDIT":
    case "ROLL_DEBIT":
      return "ROLL";
    case "EXPIRED_WORTHLESS":
      return "EXPIRE";
    case "ASSIGNED":
      return "ASSIGN";
    case "EXERCISED":
      return "EXERCISE";
    case "DIVIDEND":
    case "INTEREST":
      return "INCOME";
    case "FEE":
      return "EXPENSE";
    case "NOTE":
      return "NOTE_ONLY";
    default:
      return "ADJUST";
  }
}

function inferResultingStatus(actionType: string): string | null {
  switch (actionType) {
    case "STO":
    case "BTO":
      return "OPEN";
    case "BTC":
    case "STC":
      return "CLOSED";
    case "ROLL_CREDIT":
    case "ROLL_DEBIT":
      return "ROLLED";
    case "EXPIRED_WORTHLESS":
      return "EXPIRED";
    case "ASSIGNED":
      return "ASSIGNED";
    case "EXERCISED":
      return "EXERCISED";
    default:
      return null;
  }
}

const OPTION_PREMIUM_ACTION_TYPES = new Set(["STO", "BTO", "BTC", "STC", "ROLL_CREDIT", "ROLL_DEBIT"]);

function parseNumber(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFetchSubmission(req: Request) {
  return req.headers.get("x-ui-submit-mode") === "fetch";
}

function respondWithMessage(
  req: Request,
  id: string,
  tone: "success" | "error",
  message: string,
  status?: number,
) {
  const url = new URL(`/positions/${id}`, req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);

  if (isFetchSubmission(req)) {
    return NextResponse.json(
      {
        ok: tone === "success",
        tone,
        notice: message,
        redirectTo: `${url.pathname}${url.search}`,
      },
      { status: status ?? (tone === "success" ? 200 : 400) },
    );
  }

  return NextResponse.redirect(url);
}

export async function POST(req: Request, { params }: RouteProps) {
  const { id } = await params;
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, `/positions/${id}`);
  }

  const form = await req.formData();

  const actionType = (form.get("actionType") as string)?.trim();
  const amountRaw = form.get("amount") as string | null;
  const feeAmountRaw = form.get("feeAmount") as string | null;
  const currency = ((form.get("currency") as string) || "USD").trim();
  const quantityRaw = form.get("quantity") as string | null;
  const premiumRaw = ((form.get("premium") as string | null) ?? (form.get("premiumPerUnit") as string | null));
  const resultingStatusRaw = form.get("resultingStatus") as string | null;
  const disciplineRating = ((form.get("disciplineRating") as string) || "UNRATED").trim();
  const notes = form.get("notes") as string | null;
  const actionTimestampRaw = ((form.get("actionTimestamp") as string) || "").trim();
  const assignmentShareQtyRaw = form.get("assignmentShareQty") as string | null;
  const assignmentPriceRaw = form.get("assignmentPrice") as string | null;

  const amount = parseNumber(amountRaw);
  const feeAmount = parseNumber(feeAmountRaw) ?? 0;
  const quantity = parseNumber(quantityRaw);
  const premiumPerUnit = parseNumber(premiumRaw);
  const assignmentShareQty = parseNumber(assignmentShareQtyRaw);
  const assignmentPrice = parseNumber(assignmentPriceRaw);

  if (!actionType) {
    return respondWithMessage(req, id, "error", "Action type is required.");
  }

  const position = await findOwnedPositionForUser(user.id, id, {
    linkedHolding: true,
  });

  if (!position) {
    return respondWithMessage(req, id, "error", "Position not found.");
  }

  if (feeAmount < 0) {
    return respondWithMessage(req, id, "error", "Fee amount cannot be negative.");
  }

  if (quantityRaw && (quantity === null || quantity <= 0)) {
    return respondWithMessage(req, id, "error", "Quantity must be greater than zero when provided.");
  }

  if (premiumRaw && premiumRaw.trim() !== "" && premiumPerUnit === null) {
    return respondWithMessage(req, id, "error", "Premium must be a valid number.");
  }

  if (amountRaw && amount === null) {
    return respondWithMessage(req, id, "error", "Amount must be a valid number.");
  }

  if (actionType === "ASSIGNED") {
    if (position.linkedHoldingId || position.linkedHolding) {
      return respondWithMessage(req, id, "error", "This position is already linked to a holding. Duplicate assignment is blocked.");
    }

    if (assignmentShareQty !== null && assignmentShareQty <= 0) {
      return respondWithMessage(req, id, "error", "Assignment share quantity must be greater than zero.");
    }

    if (assignmentPrice !== null && assignmentPrice < 0) {
      return respondWithMessage(req, id, "error", "Assignment price cannot be negative.");
    }
  }

  const actionTimestamp = new Date(actionTimestampRaw);

  if (Number.isNaN(actionTimestamp.getTime())) {
    return respondWithMessage(req, id, "error", "Action timestamp is invalid.");
  }

  const normalizedPremiumRaw = premiumRaw && premiumRaw.trim() !== "" && premiumPerUnit !== null
    ? Math.abs(premiumPerUnit).toString()
    : null;
  const isOptionPremiumAction = OPTION_PREMIUM_ACTION_TYPES.has(actionType);

  const actionEffect = inferActionEffect(actionType);
  const inferredStatus = inferResultingStatus(actionType);
  const finalStatus = resultingStatusRaw && resultingStatusRaw.trim() !== "" ? resultingStatusRaw.trim() : inferredStatus;

  const createdAction = await prisma.positionAction.create({
    data: {
      positionId: id,
      actionTimestamp,
      actionType: actionType as PositionActionType,
      actionEffect: actionEffect as ActionEffectType,
      amount: !isOptionPremiumAction && amountRaw && amountRaw.trim() !== "" ? amountRaw.trim() : null,
      feeAmount: feeAmountRaw && feeAmountRaw.trim() !== "" ? feeAmountRaw.trim() : "0",
      currency,
      quantity: quantityRaw && quantityRaw.trim() !== "" ? quantityRaw.trim() : null,
      premiumPerUnit: normalizedPremiumRaw,
      resultingStatus: finalStatus ? (finalStatus as PositionStatus) : null,
      disciplineRating: disciplineRating as DisciplineRating,
      notes: notes && notes.trim() !== "" ? notes.trim() : null,
    },
  });

  // IMPORTANT: When the first STO or BTO action is created, update both position and all legs' openedAt timestamp.
  // This ensures the position and its legs have the correct opening date matching when the trade was actually entered,
  // not when the position record was created in the system.
  // Subsequent actions don't update this - only the first STO/BTO opening action does.
  // This prevents "closed_after_open" constraint violations when rolling with historical timestamps,
  // and ensures accurate trade entry date tracking throughout position lifecycle.
  if ((actionType === "STO" || actionType === "BTO") && !isNaN(actionTimestamp.getTime())) {
    const existingStoOrBtoCount = await prisma.positionAction.count({
      where: {
        positionId: id,
        actionType: { in: ["STO" as PositionActionType, "BTO" as PositionActionType] },
        id: { not: createdAction.id }, // Exclude the current action we just created
      },
    });

    // If this is the first STO/BTO action, update position and all legs to have this action's timestamp
    if (existingStoOrBtoCount === 0) {
      await prisma.position.update({
        where: { id },
        data: { openedAt: actionTimestamp },
      });

      await prisma.positionLeg.updateMany({
        where: { positionId: id },
        data: { openedAt: actionTimestamp },
      });
    }
  }

  if (finalStatus) {
    await prisma.position.update({
      where: { id },
      data: {
        currentStatus: finalStatus as PositionStatus,
      },
    });
  }

  if (actionType === "ASSIGNED") {
    const shareQty = assignmentShareQtyRaw && assignmentShareQtyRaw.trim() !== "" ? assignmentShareQtyRaw.trim() : "100";
    const pricePerShare = assignmentPriceRaw && assignmentPriceRaw.trim() !== "" ? assignmentPriceRaw.trim() : "0";

    const createdHolding = await prisma.holding.create({
      data: {
        brokerAccountId: position.brokerAccountId ?? null,
        sourceType: "ASSIGNED_FROM_PUT" as HoldingSourceType,
        symbol: position.underlyingSymbol,
        quantity: shareQty,
        openQuantity: shareQty,
        remainingQuantity: shareQty,
        costBasisPerShare: pricePerShare,
        openedAt: new Date(),
        holdingStatus: "OPEN" as HoldingStatus,
        linkedPositionId: position.id,
        notes: `Auto-created from assignment action on position ${position.id}`,
      },
    });

    await prisma.position.update({
      where: { id },
      data: {
        linkedHoldingId: createdHolding.id,
      },
    });

    const stockAcquisitionAmount = assignmentPrice !== null && assignmentShareQty !== null
      ? (assignmentPrice * assignmentShareQty).toString()
      : assignmentPriceRaw && assignmentPriceRaw.trim() !== ""
        ? (Number(pricePerShare) * Number(shareQty)).toString()
        : null;

    const createdHoldingEvent = await prisma.holdingEvent.create({
      data: {
        holdingId: createdHolding.id,
        eventTimestamp: actionTimestamp,
        eventType: "ACQUIRED" as HoldingEventType,
        quantity: shareQty,
        pricePerShare: assignmentPriceRaw && assignmentPriceRaw.trim() !== "" ? assignmentPriceRaw.trim() : null,
        amount: stockAcquisitionAmount,
        feeAmount: feeAmountRaw && feeAmountRaw.trim() !== "" ? feeAmountRaw.trim() : "0",
        currency,
        linkedPositionActionId: createdAction.id,
        notes: "Auto-created from ASSIGNED action",
      },
    });

    await syncCashLedgerEntriesForHoldingEvent(createdHoldingEvent.id);
    await syncHoldingPnlSnapshot(createdHolding.id);
  }

  await syncCashLedgerEntriesForPositionAction(createdAction.id);
  await syncPositionPnlSnapshot(id);

  return respondWithMessage(req, id, "success", "Action added successfully.");
}
