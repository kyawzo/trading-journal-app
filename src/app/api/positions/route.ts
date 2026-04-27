import { AssetClass, PositionSourceType, PositionStatus, StrategyType } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { getWorkspacePreference } from "@/src/lib/workspace-preference";

function parseNumber(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function redirectWithMessage(req: Request, path: string, tone: "success" | "error", message: string) {
  const url = new URL(path, req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);
  return NextResponse.redirect(url);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, "/positions/new");
  }

  const form = await req.formData();
  const workspace = await getWorkspacePreference();

  if (!workspace.activeBrokerAccountId) {
    return redirectWithMessage(req, "/positions/new", "error", "Choose an active broker account before creating a new position.");
  }

  const brokerAccount = await prisma.brokerAccount.findFirst({
    where: {
      id: workspace.activeBrokerAccountId,
      userId: user.id,
    },
  });

  if (!brokerAccount || !brokerAccount.isActive) {
    return redirectWithMessage(req, "/broker-accounts", "error", "The active broker account is unavailable. Please choose another account.");
  }

  const symbol = ((form.get("symbol") as string) || "").trim().toUpperCase();
  const strategy = ((form.get("strategy") as string) || "").trim().toUpperCase();
  const linkedHoldingId = ((form.get("linkedHoldingId") as string) || "").trim() || null;

  if (!symbol || !strategy) {
    return redirectWithMessage(req, "/positions/new", "error", "Symbol and strategy are required.");
  }

  if (!Object.values(StrategyType).includes(strategy as StrategyType)) {
    return redirectWithMessage(req, "/positions/new", "error", "Please choose a valid strategy.");
  }

  const parsedStrategy = strategy as StrategyType;
  let linkedHolding = null;

  if (linkedHoldingId) {
    linkedHolding = await prisma.holding.findFirst({
      where: {
        id: linkedHoldingId,
        brokerAccount: {
          userId: user.id,
        },
      },
    });

    if (!linkedHolding) {
      return redirectWithMessage(req, "/positions/new", "error", "Linked holding not found.");
    }

    if (linkedHolding.brokerAccountId !== brokerAccount.id) {
      return redirectWithMessage(req, "/positions/new", "error", "Linked holding must belong to the active broker account.");
    }

    if (linkedHolding.symbol.toUpperCase() !== symbol) {
      return redirectWithMessage(req, "/positions/new", "error", "Linked holding symbol must match the position symbol.");
    }
  }

  if (parsedStrategy === StrategyType.CC) {
    if (!linkedHolding) {
      return redirectWithMessage(req, "/positions/new", "error", "Covered call positions must be linked to a holding.");
    }

    const remainingShares = parseNumber(String(linkedHolding.remainingQuantity));

    if (remainingShares === null || remainingShares < 100) {
      return redirectWithMessage(req, "/positions/new", "error", "Covered call positions require at least 100 remaining shares in the linked holding.");
    }

    if (!["OPEN", "PARTIALLY_SOLD"].includes(linkedHolding.holdingStatus)) {
      return redirectWithMessage(req, "/positions/new", "error", "Covered call positions can only be opened from an active holding.");
    }
  }

  const position = await prisma.position.create({
    data: {
      brokerAccountId: brokerAccount.id,
      sourceType: PositionSourceType.MANUAL,
      assetClass: AssetClass.OPTION,
      strategyType: parsedStrategy,
      underlyingSymbol: symbol,
      openedAt: new Date(),
      currentStatus: PositionStatus.OPEN,
      linkedHoldingId,
      isWheelRelated: parsedStrategy === StrategyType.CC || parsedStrategy === StrategyType.CSP,
      tradeNotes:
        linkedHolding && parsedStrategy === StrategyType.CC
          ? `Covered call opened from holding ${linkedHolding.id}`
          : null,
    },
  });

  return NextResponse.redirect(new URL(`/positions/${position.id}`, req.url));
}
