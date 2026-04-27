import { HoldingSourceType } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "../../../../lib/auth";
import { parseHoldingNumberInput } from "../../../../lib/holding-rules";
import { findOwnedHoldingForUser } from "../../../../lib/ownership";
import { prisma } from "../../../../lib/prisma";

type RouteProps = {
  params: Promise<{ id: string }>;
};

const MUTABLE_SOURCE_TYPES = new Set(["MANUAL_BUY", "TRANSFER_IN", "OTHER"]);

function redirectWithMessage(req: Request, id: string, tone: "success" | "error", message: string) {
  const url = new URL(`/holdings/${id}`, req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);
  return NextResponse.redirect(url);
}

export async function POST(req: Request, { params }: RouteProps) {
  const { id } = await params;
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, `/holdings/${id}`);
  }

  const form = await req.formData();
  const intent = ((form.get("intent") as string) || "update").trim();

  const holding = await findOwnedHoldingForUser(user.id, id, {
    linkedPosition: true,
    linkedFromPositions: true,
  });

  if (!holding) {
    return redirectWithMessage(req, id, "error", "Holding not found.");
  }

  if (intent === "archive") {
    if (Number(holding.remainingQuantity.toString()) > 0) {
      return redirectWithMessage(req, id, "error", "Only holdings with zero remaining shares can be archived.");
    }

    if (holding.linkedFromPositions.length > 0) {
      return redirectWithMessage(req, id, "error", "This holding is still linked to positions. Unlink or close them first.");
    }

    await prisma.holding.update({
      where: { id },
      data: {
        holdingStatus: "ARCHIVED",
      },
    });

    return redirectWithMessage(req, id, "success", "Holding archived successfully.");
  }

  const symbol = ((form.get("symbol") as string) || "").trim().toUpperCase();
  const sourceType = ((form.get("sourceType") as string) || holding.sourceType).trim();
  const openedAtRaw = ((form.get("openedAt") as string) || "").trim();
  const costBasisPerShareRaw = ((form.get("costBasisPerShare") as string) || "").trim();
  const notes = ((form.get("notes") as string) || "").trim();

  const openedAt = openedAtRaw ? new Date(openedAtRaw) : holding.openedAt;
  const costBasisPerShare = parseHoldingNumberInput(costBasisPerShareRaw);

  if (openedAtRaw && Number.isNaN(openedAt.getTime())) {
    return redirectWithMessage(req, id, "error", "Opened at is invalid.");
  }

  if (costBasisPerShareRaw && (costBasisPerShare === null || costBasisPerShare < 0)) {
    return redirectWithMessage(req, id, "error", "Cost basis per share must be zero or greater.");
  }

  const hasPositionLinks = Boolean(holding.linkedPosition) || holding.linkedFromPositions.length > 0;

  if (symbol && hasPositionLinks && symbol !== holding.symbol) {
    return redirectWithMessage(req, id, "error", "Symbol cannot be changed while this holding is linked to positions.");
  }

  if (!MUTABLE_SOURCE_TYPES.has(sourceType) && sourceType !== holding.sourceType) {
    return redirectWithMessage(req, id, "error", "Only manual-style source types can be assigned from this UI.");
  }

  await prisma.holding.update({
    where: { id },
    data: {
      symbol: symbol || holding.symbol,
      sourceType: sourceType as HoldingSourceType,
      openedAt,
      costBasisPerShare: costBasisPerShare !== null ? costBasisPerShare.toString() : holding.costBasisPerShare,
      notes: notes || null,
    },
  });

  return redirectWithMessage(req, id, "success", "Holding updated successfully.");
}

