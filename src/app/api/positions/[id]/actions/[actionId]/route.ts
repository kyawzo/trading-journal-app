import { ActionEffectType, DisciplineRating, PositionActionType, PositionStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "../../../../../../lib/auth";
import { deleteCashLedgerEntriesForPositionAction, syncCashLedgerEntriesForPositionAction } from "../../../../../../lib/cash-ledger-sync";
import { findOwnedPositionActionForUser } from "../../../../../../lib/ownership";
import { parseNumericInput, syncPositionStatusFromActions } from "../../../../../../lib/position-rules";
import { prisma } from "../../../../../../lib/prisma";

type RouteProps = {
  params: Promise<{ id: string; actionId: string }>;
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

function redirectWithMessage(req: Request, id: string, tone: "success" | "error", message: string) {
  const url = new URL(`/positions/${id}`, req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);
  return NextResponse.redirect(url);
}

export async function POST(req: Request, { params }: RouteProps) {
  const { id, actionId } = await params;
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, `/positions/${id}`);
  }

  const form = await req.formData();
  const intent = ((form.get("intent") as string) || "update").trim();

  const action = await findOwnedPositionActionForUser(user.id, id, actionId, {
    holdingEvents: true,
    actionLegChanges: true,
  });

  if (!action) {
    return redirectWithMessage(req, id, "error", "Action not found.");
  }

  if (action.actionType === "ASSIGNED" || action.holdingEvents.length > 0 || action.actionLegChanges.length > 0) {
    return redirectWithMessage(
      req,
      id,
      "error",
      action.actionLegChanges.length > 0
        ? "Roll actions that already created replacement leg history cannot be edited or deleted from this UI yet."
        : "Assigned actions that already created holding records cannot be edited or deleted from this UI yet."
    );
  }

  if (intent === "delete") {
    await deleteCashLedgerEntriesForPositionAction(actionId);
    await prisma.positionAction.delete({ where: { id: actionId } });
    await syncPositionStatusFromActions(id);
    return redirectWithMessage(req, id, "success", "Action deleted successfully.");
  }

  const actionType = ((form.get("actionType") as string) || "").trim();
  const amountRaw = (form.get("amount") as string | null)?.trim() || null;
  const feeAmountRaw = (form.get("feeAmount") as string | null)?.trim() || null;
  const currency = ((form.get("currency") as string) || "USD").trim();
  const quantityRaw = (form.get("quantity") as string | null)?.trim() || null;
  const premiumRaw = (((form.get("premium") as string | null) ?? (form.get("premiumPerUnit") as string | null))?.trim()) || null;
  const resultingStatusRaw = (form.get("resultingStatus") as string | null)?.trim() || null;
  const disciplineRating = ((form.get("disciplineRating") as string) || "UNRATED").trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const actionTimestampRaw = ((form.get("actionTimestamp") as string) || "").trim();

  const amount = parseNumericInput(amountRaw);
  const feeAmount = parseNumericInput(feeAmountRaw) ?? 0;
  const quantity = parseNumericInput(quantityRaw);
  const premiumPerUnit = parseNumericInput(premiumRaw);

  if (!actionType) {
    return redirectWithMessage(req, id, "error", "Action type is required.");
  }

  if (actionType === "ASSIGNED") {
    return redirectWithMessage(req, id, "error", "Editing an existing action into ASSIGNED is blocked in this UI.");
  }

  if (!actionTimestampRaw) {
    return redirectWithMessage(req, id, "error", "Action timestamp is required.");
  }

  const actionTimestamp = new Date(actionTimestampRaw);

  if (Number.isNaN(actionTimestamp.getTime())) {
    return redirectWithMessage(req, id, "error", "Action timestamp is invalid.");
  }

  if (feeAmount < 0) {
    return redirectWithMessage(req, id, "error", "Fee amount cannot be negative.");
  }

  if (amountRaw && amount === null) {
    return redirectWithMessage(req, id, "error", "Amount must be a valid number.");
  }

  if (quantityRaw && (quantity === null || quantity <= 0)) {
    return redirectWithMessage(req, id, "error", "Quantity must be greater than zero when provided.");
  }

  if (premiumRaw && premiumPerUnit === null) {
    return redirectWithMessage(req, id, "error", "Premium must be a valid number.");
  }

  const isOptionPremiumAction = OPTION_PREMIUM_ACTION_TYPES.has(actionType);
  const normalizedPremiumRaw = premiumRaw && premiumPerUnit !== null ? Math.abs(premiumPerUnit).toString() : null;

  const actionEffect = inferActionEffect(actionType);
  const inferredStatus = inferResultingStatus(actionType);
  const trimmedResultingStatus = resultingStatusRaw?.trim() || null;
  const shouldRefreshAutoStatus =
    actionType !== action.actionType &&
    trimmedResultingStatus === (action.resultingStatus ?? null);
  const finalStatus = shouldRefreshAutoStatus ? inferredStatus : (trimmedResultingStatus || inferredStatus);

  await prisma.positionAction.update({
    where: { id: actionId },
    data: {
      actionTimestamp,
      actionType: actionType as PositionActionType,
      actionEffect: actionEffect as ActionEffectType,
      amount: isOptionPremiumAction ? null : amountRaw,
      feeAmount: feeAmountRaw || "0",
      currency,
      quantity: quantityRaw,
      premiumPerUnit: normalizedPremiumRaw,
      resultingStatus: finalStatus ? (finalStatus as PositionStatus) : null,
      disciplineRating: disciplineRating as DisciplineRating,
      notes,
    },
  });

  await syncCashLedgerEntriesForPositionAction(actionId);
  await syncPositionStatusFromActions(id);

  return redirectWithMessage(req, id, "success", "Action updated successfully.");
}

