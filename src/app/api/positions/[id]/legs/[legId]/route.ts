import { LegSide, LegStatus, LegType, OptionType } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "../../../../../../lib/auth";
import { getPositionStrategyLegTemplate, supportsGroupedLegEditing } from "../../../../../../lib/position-leg-templates";
import { findOwnedPositionForUser } from "../../../../../../lib/ownership";
import { calculateCoveredCallShareUsage, parseNumericInput, toNumber } from "../../../../../../lib/position-rules";
import { prisma } from "../../../../../../lib/prisma";

type RouteProps = {
  params: Promise<{ id: string; legId: string }>;
};

function redirectWithMessage(req: Request, id: string, tone: "success" | "error", message: string) {
  const url = new URL(`/positions/${id}`, req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);
  return NextResponse.redirect(url);
}

export async function POST(req: Request, { params }: RouteProps) {
  const { id, legId } = await params;
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, `/positions/${id}`);
  }

  const form = await req.formData();
  const intent = ((form.get("intent") as string) || "update").trim();

  const position = await findOwnedPositionForUser(user.id, id, {
    linkedHolding: true,
    legs: true,
  });

  if (!position) {
    return redirectWithMessage(req, id, "error", "Position not found.");
  }

  const existingLeg = position.legs.find((leg) => leg.id === legId);

  if (!existingLeg) {
    return redirectWithMessage(req, id, "error", "Leg not found.");
  }

  if (intent === "delete") {
    await prisma.positionLeg.delete({ where: { id: legId } });
    return redirectWithMessage(req, id, "success", "Leg deleted successfully.");
  }

  const template = getPositionStrategyLegTemplate(position.strategyType);
  const structuredPosition = !!template;
  const allowSharedEdit = supportsGroupedLegEditing(position.strategyType);
  const applySharedFields = allowSharedEdit && form.get("applySharedFields") === "on";

  const submittedLegType = ((form.get("legType") as string) || "").trim();
  const submittedLegSide = ((form.get("legSide") as string) || "").trim();
  const submittedOptionType = (form.get("optionType") as string | null)?.trim() || null;
  const strikePriceRaw = (form.get("strikePrice") as string | null)?.trim() || null;
  const quantityRaw = ((form.get("quantity") as string) || "").trim();
  const multiplierRaw = ((form.get("multiplier") as string) || "1").trim();
  const expiryDateRaw = (form.get("expiryDate") as string | null)?.trim() || null;
  const submittedLegRole = (form.get("legRole") as string | null)?.trim() || null;
  const legStatus = ((form.get("legStatus") as string) || "OPEN").trim();

  const legType = structuredPosition ? existingLeg.legType : submittedLegType;
  const legSide = structuredPosition ? existingLeg.legSide : submittedLegSide;
  const optionTypeRaw = structuredPosition ? existingLeg.optionType : submittedOptionType;
  const legRole = structuredPosition ? existingLeg.legRole : submittedLegRole;

  const quantity = parseNumericInput(quantityRaw);
  const multiplier = parseNumericInput(multiplierRaw);
  const strikePrice = parseNumericInput(strikePriceRaw);

  if (!legType || !legSide || !quantityRaw) {
    return redirectWithMessage(req, id, "error", "Leg type, leg side, and quantity are required.");
  }

  if (quantity === null || quantity <= 0) {
    return redirectWithMessage(req, id, "error", "Quantity must be greater than zero.");
  }

  if (multiplier === null || multiplier <= 0) {
    return redirectWithMessage(req, id, "error", "Multiplier must be greater than zero.");
  }

  if (legType === "OPTION") {
    if (!optionTypeRaw || !strikePriceRaw || !expiryDateRaw) {
      return redirectWithMessage(req, id, "error", "Option legs require option type, strike price, and expiry date.");
    }

    if (strikePrice === null || strikePrice <= 0) {
      return redirectWithMessage(req, id, "error", "Strike price must be greater than zero.");
    }
  }

  if (position.strategyType === "CC" && legType === "OPTION" && legSide === "SHORT" && optionTypeRaw === "CALL") {
    if (!position.linkedHolding) {
      return redirectWithMessage(req, id, "error", "Covered call positions require a linked holding before adding a short call leg.");
    }

    const remainingShares = toNumber(position.linkedHolding.remainingQuantity);
    const existingCoverage = calculateCoveredCallShareUsage(position.legs, { excludeLegId: legId });
    const requestedCoverage = quantity * multiplier;

    if (existingCoverage + requestedCoverage > remainingShares) {
      return redirectWithMessage(
        req,
        id,
        "error",
        `This covered call update needs ${requestedCoverage} shares, but only ${remainingShares} linked shares are available.`
      );
    }
  }

  const updateData = {
    legType: legType as LegType,
    legSide: legSide as LegSide,
    optionType: legType === "OPTION" ? (optionTypeRaw as OptionType) : null,
    expiryDate: legType === "OPTION" && expiryDateRaw ? new Date(expiryDateRaw) : null,
    strikePrice: legType === "OPTION" ? strikePriceRaw : null,
    quantity: quantityRaw,
    multiplier: multiplierRaw,
    legRole,
    legStatus: legStatus as LegStatus,
  };

  if (applySharedFields) {
    const siblingIds = position.legs.filter((leg) => leg.id !== legId).map((leg) => leg.id);

    await prisma.$transaction([
      prisma.positionLeg.update({
        where: { id: legId },
        data: updateData,
      }),
      ...(siblingIds.length > 0
        ? [
            prisma.positionLeg.updateMany({
              where: { id: { in: siblingIds } },
              data: {
                quantity: quantityRaw,
                multiplier: multiplierRaw,
                expiryDate: expiryDateRaw ? new Date(expiryDateRaw) : null,
              },
            }),
          ]
        : []),
    ]);

    return redirectWithMessage(req, id, "success", "Leg updated successfully. Shared quantity, multiplier, and expiry were applied to sibling legs too.");
  }

  await prisma.positionLeg.update({
    where: { id: legId },
    data: updateData,
  });

  return redirectWithMessage(req, id, "success", "Leg updated successfully.");
}

