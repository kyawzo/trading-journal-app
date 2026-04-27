import { syncCashLedgerEntriesForPositionAction } from "./cash-ledger-sync";
import { calculateCoveredCallShareUsage, parseNumericInput, toNumber } from "./position-rules";
import { prisma } from "./prisma";

type RollActionType = "ROLL_CREDIT" | "ROLL_DEBIT";

type RollableLeg = {
  id: string;
  positionId: string;
  legType: string;
  legSide: string;
  optionType: string | null;
  optionStyle: string | null;
  underlyingSymbol: string;
  expiryDate: Date | null;
  strikePrice: { toString(): string } | null;
  quantity: { toString(): string };
  multiplier: { toString(): string };
  legRole: string | null;
  legStatus: string;
};

type RollPositionInput = {
  positionId: string;
  strategyType: string;
  linkedHoldingRemainingQuantity?: number | string | bigint | { toString(): string } | null | undefined;
  existingLegs: Array<RollableLeg>;
  actionType: RollActionType;
  actionTimestamp: Date;
  premiumRaw: string | null;
  feeAmountRaw: string | null;
  currency: string;
  quantityRaw: string | null;

  disciplineRating: string;
  notes: string | null;
  resultingStatus: string | null;
  selectedLegIds: string[];
  newExpiryDateRaw: string;
  newQuantityRaw: string | null;
  newMultiplierRaw: string | null;
  strikeByLegId: Record<string, string>;
};

const ROLLABLE_STATUSES = new Set(["OPEN", "PARTIALLY_CLOSED"]);

function inferActionEffect(actionType: RollActionType) {
  return actionType === "ROLL_CREDIT" || actionType === "ROLL_DEBIT" ? "ROLL" : "ADJUST";
}

export async function createPositionRoll(input: RollPositionInput) {
  const selectedLegs = input.existingLegs.filter((leg) => input.selectedLegIds.includes(leg.id));

  if (selectedLegs.length === 0) {
    throw new Error("Select at least one leg to roll.");
  }

  if (selectedLegs.some((leg) => leg.positionId !== input.positionId)) {
    throw new Error("One or more selected legs do not belong to this position.");
  }

  if (selectedLegs.some((leg) => leg.legType !== "OPTION")) {
    throw new Error("Only option legs can be rolled in this workflow right now.");
  }

  if (selectedLegs.some((leg) => !ROLLABLE_STATUSES.has(leg.legStatus))) {
    throw new Error("Only open or partially closed legs can be rolled.");
  }

  const newExpiryDate = new Date(input.newExpiryDateRaw);
  if (!input.newExpiryDateRaw || Number.isNaN(newExpiryDate.getTime())) {
    throw new Error("A valid new expiry date is required for the replacement legs.");
  }

  const replacementQuantity = input.newQuantityRaw?.trim() ? parseNumericInput(input.newQuantityRaw) : null;
  const replacementMultiplier = input.newMultiplierRaw?.trim() ? parseNumericInput(input.newMultiplierRaw) : null;

  if (input.newQuantityRaw?.trim() && (replacementQuantity === null || replacementQuantity <= 0)) {
    throw new Error("Replacement quantity must be greater than zero.");
  }

  if (input.newMultiplierRaw?.trim() && (replacementMultiplier === null || replacementMultiplier <= 0)) {
    throw new Error("Replacement multiplier must be greater than zero.");
  }

  for (const leg of selectedLegs) {
    const rawStrike = input.strikeByLegId[leg.id]?.trim();
    const parsedStrike = parseNumericInput(rawStrike);

    if (!rawStrike || parsedStrike === null || parsedStrike <= 0) {
      throw new Error(`Replacement strike is required for ${leg.legRole ?? leg.id}.`);
    }
  }

  if (input.strategyType === "CC") {
    const linkedShares = toNumber(input.linkedHoldingRemainingQuantity);
    const existingCoverage = calculateCoveredCallShareUsage(input.existingLegs, {
      excludeLegIds: input.selectedLegIds,
    });

    const replacementCoverage = selectedLegs.reduce((total, leg) => {
      if (leg.legSide !== "SHORT" || leg.optionType !== "CALL") {
        return total;
      }

      const qty = replacementQuantity ?? toNumber(leg.quantity);
      const multiplier = replacementMultiplier ?? toNumber(leg.multiplier);
      return total + qty * multiplier;
    }, 0);

    if (existingCoverage + replacementCoverage > linkedShares) {
      throw new Error(`This covered call roll needs ${replacementCoverage} shares, but only ${linkedShares} linked shares are available.`);
    }
  }

  const finalStatus = input.resultingStatus?.trim() ? input.resultingStatus.trim() : "OPEN";
  const parsedPremium = input.premiumRaw?.trim() ? parseNumericInput(input.premiumRaw) : null;

  if (input.premiumRaw?.trim() && parsedPremium === null) {
    throw new Error("Premium must be a valid number.");
  }

  const normalizedPremiumRaw = parsedPremium !== null ? Math.abs(parsedPremium).toString() : null;

  const createdAction = await prisma.$transaction(async (tx) => {
    const action = await tx.positionAction.create({
      data: {
        positionId: input.positionId,
        actionTimestamp: input.actionTimestamp,
        actionType: input.actionType as any,
        actionEffect: inferActionEffect(input.actionType) as any,
        amount: null,
        feeAmount: input.feeAmountRaw?.trim() ? input.feeAmountRaw.trim() : "0",
        currency: input.currency,
        quantity: input.quantityRaw?.trim() ? input.quantityRaw.trim() : null,
        premiumPerUnit: normalizedPremiumRaw,
        resultingStatus: finalStatus as any,
        disciplineRating: input.disciplineRating as any,
        notes: input.notes?.trim() ? input.notes.trim() : null,
      },
    });

    for (const oldLeg of selectedLegs) {
      const replacementStrike = input.strikeByLegId[oldLeg.id].trim();
      const replacementQty = input.newQuantityRaw?.trim() ? input.newQuantityRaw.trim() : oldLeg.quantity.toString();
      const replacementMult = input.newMultiplierRaw?.trim() ? input.newMultiplierRaw.trim() : oldLeg.multiplier.toString();

      await tx.positionLeg.update({
        where: { id: oldLeg.id },
        data: {
          legStatus: "ROLLED" as any,
          closedAt: input.actionTimestamp,
        },
      });

      const newLeg = await tx.positionLeg.create({
        data: {
          positionId: input.positionId,
          legType: oldLeg.legType as any,
          legSide: oldLeg.legSide as any,
          optionType: oldLeg.optionType ? (oldLeg.optionType as any) : null,
          optionStyle: oldLeg.optionStyle ? (oldLeg.optionStyle as any) : null,
          underlyingSymbol: oldLeg.underlyingSymbol,
          expiryDate: newExpiryDate,
          strikePrice: replacementStrike,
          quantity: replacementQty,
          multiplier: replacementMult,
          legRole: oldLeg.legRole,
          openedAt: input.actionTimestamp,
          legStatus: "OPEN" as any,
          parentLegId: oldLeg.id,
        },
      });

      await tx.actionLegChange.create({
        data: {
          positionActionId: action.id,
          oldLegId: oldLeg.id,
          newLegId: newLeg.id,
          changeType: "REPLACE" as any,
          quantityChanged: replacementQty,
          notes: `Rolled ${oldLeg.legRole ?? oldLeg.id} into replacement contract.`,
        },
      });
    }

    await tx.position.update({
      where: { id: input.positionId },
      data: {
        currentStatus: finalStatus as any,
      },
    });

    return action;
  });

  await syncCashLedgerEntriesForPositionAction(createdAction.id);

  return createdAction;
}



