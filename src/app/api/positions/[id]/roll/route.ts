import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "../../../../../lib/auth";
import { findOwnedPositionForUser } from "../../../../../lib/ownership";
import { createPositionRoll } from "../../../../../lib/position-rolls";

type RouteProps = {
  params: Promise<{ id: string }>;
};

function redirectWithMessage(req: Request, id: string, tone: "success" | "error", message: string) {
  const url = new URL(`/positions/${id}`, req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);
  return NextResponse.redirect(url);
}

function jsonErrorResponse(message: string, status: number = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request, { params }: RouteProps) {
  const { id } = await params;
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, `/positions/${id}`);
  }

  const form = await req.formData();

  const actionType = ((form.get("actionType") as string) || "").trim();
  const actionTimestampRaw = ((form.get("actionTimestamp") as string) || "").trim();
  const premiumRaw = (((form.get("premium") as string | null) ?? (form.get("premiumPerUnit") as string | null))?.trim()) || null;
  const feeAmountRaw = (form.get("feeAmount") as string | null)?.trim() || null;
  const quantityRaw = (form.get("quantity") as string | null)?.trim() || null;
  const resultingStatus = (form.get("resultingStatus") as string | null)?.trim() || null;
  const disciplineRating = ((form.get("disciplineRating") as string) || "UNRATED").trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const newExpiryDateRaw = ((form.get("newExpiryDate") as string) || "").trim();
  const newQuantityRaw = (form.get("newQuantity") as string | null)?.trim() || null;
  const newMultiplierRaw = (form.get("newMultiplier") as string | null)?.trim() || null;
  const selectedLegIds = form.getAll("selectedLegIds").map((value) => String(value));

  if (actionType !== "ROLL_CREDIT" && actionType !== "ROLL_DEBIT") {
    return jsonErrorResponse("Roll type must be ROLL_CREDIT or ROLL_DEBIT.");
  }

  const actionTimestamp = new Date(actionTimestampRaw);
  if (!actionTimestampRaw || Number.isNaN(actionTimestamp.getTime())) {
    return jsonErrorResponse("A valid roll timestamp is required.");
  }

  const position = await findOwnedPositionForUser(user.id, id, {
    linkedHolding: true,
    legs: true,
    brokerAccount: true,
  });

  if (!position) {
    return jsonErrorResponse("Position not found.");
  }
  const currency = position.brokerAccount?.baseCurrency ?? "USD";

  const strikeByLegId: Record<string, string> = {};
  for (const legId of selectedLegIds) {
    strikeByLegId[legId] = ((form.get(`strike_${legId}`) as string) || "").trim();
  }

  try {
    await createPositionRoll({
      positionId: id,
      strategyType: position.strategyType,
      linkedHoldingRemainingQuantity: position.linkedHolding?.remainingQuantity,
      existingLegs: position.legs.map((leg) => ({
        id: leg.id,
        positionId: leg.positionId,
        legType: leg.legType,
        legSide: leg.legSide,
        optionType: leg.optionType,
        optionStyle: leg.optionStyle,
        underlyingSymbol: leg.underlyingSymbol,
        expiryDate: leg.expiryDate,
        strikePrice: leg.strikePrice,
        quantity: leg.quantity,
        multiplier: leg.multiplier,
        legRole: leg.legRole,
        legStatus: leg.legStatus,
      })),
      actionType,
      actionTimestamp,
      premiumRaw,
      feeAmountRaw,
      currency,
      quantityRaw,
      disciplineRating,
      notes,
      resultingStatus,
      selectedLegIds,
      newExpiryDateRaw,
      newQuantityRaw,
      newMultiplierRaw,
      strikeByLegId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to roll the selected legs.";
    return jsonErrorResponse(message);
  }

  return NextResponse.json({ success: true });
}
