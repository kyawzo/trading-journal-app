import { HoldingEventType, HoldingSourceType, HoldingStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "@/src/lib/auth";
import { syncCashLedgerEntriesForHoldingEvent } from "@/src/lib/cash-ledger-sync";
import { parseHoldingNumberInput } from "@/src/lib/holding-rules";
import { syncHoldingPnlSnapshot } from "@/src/lib/pnl-snapshots";
import { prisma } from "@/src/lib/prisma";
import { getWorkspacePreference } from "@/src/lib/workspace-preference";

function redirectWithMessage(req: Request, path: string, tone: "success" | "error", message: string) {
  const url = new URL(path, req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);
  return NextResponse.redirect(url);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, "/holdings");
  }

  const form = await req.formData();
  const workspace = await getWorkspacePreference();

  if (!workspace.activeBrokerAccountId) {
    return redirectWithMessage(req, "/holdings", "error", "Choose an active broker account before creating a holding.");
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
  const sourceType = ((form.get("sourceType") as string) || HoldingSourceType.MANUAL_BUY).trim().toUpperCase();
  const openedAtRaw = ((form.get("openedAt") as string) || "").trim();
  const quantityRaw = ((form.get("quantity") as string) || "").trim();
  const costBasisPerShareRaw = ((form.get("costBasisPerShare") as string) || "").trim();
  const feeAmountRaw = ((form.get("feeAmount") as string) || "0").trim();
  const currency = brokerAccount.baseCurrency || "USD";
  const notes = ((form.get("notes") as string) || "").trim();

  if (!Object.values(HoldingSourceType).includes(sourceType as HoldingSourceType)) {
    return redirectWithMessage(req, "/holdings", "error", "Please choose a valid holding source type.");
  }

  const parsedSourceType = sourceType as HoldingSourceType;
  const quantity = parseHoldingNumberInput(quantityRaw);
  const costBasisPerShare = parseHoldingNumberInput(costBasisPerShareRaw);
  const feeAmount = parseHoldingNumberInput(feeAmountRaw) ?? 0;
  const openedAt = openedAtRaw ? new Date(openedAtRaw) : new Date();

  if (!symbol) {
    return redirectWithMessage(req, "/holdings", "error", "Symbol is required.");
  }

  if (Number.isNaN(openedAt.getTime())) {
    return redirectWithMessage(req, "/holdings", "error", "Opened at is invalid.");
  }

  if (quantity === null || quantity <= 0) {
    return redirectWithMessage(req, "/holdings", "error", "Share quantity must be greater than zero.");
  }

  if (costBasisPerShare === null || costBasisPerShare < 0) {
    return redirectWithMessage(req, "/holdings", "error", "Cost basis per share must be zero or greater.");
  }

  if (feeAmount < 0) {
    return redirectWithMessage(req, "/holdings", "error", "Opening fee cannot be negative.");
  }

  const amount = quantity * costBasisPerShare;
  const eventType = parsedSourceType === HoldingSourceType.TRANSFER_IN ? HoldingEventType.TRANSFER_IN : HoldingEventType.ACQUIRED;

  const holding = await prisma.holding.create({
    data: {
      brokerAccountId: brokerAccount.id,
      sourceType: parsedSourceType,
      symbol,
      quantity: quantity.toString(),
      openQuantity: quantity.toString(),
      remainingQuantity: quantity.toString(),
      costBasisPerShare: costBasisPerShare.toString(),
      openedAt,
      holdingStatus: HoldingStatus.OPEN,
      notes: notes || null,
    },
  });

  const openingEvent = await prisma.holdingEvent.create({
    data: {
      holdingId: holding.id,
      eventTimestamp: openedAt,
      eventType,
      quantity: quantity.toString(),
      pricePerShare: costBasisPerShare.toString(),
      amount: amount.toString(),
      feeAmount: feeAmount.toString(),
      currency,
      notes: notes || "Opening holding event",
    },
  });

  await syncCashLedgerEntriesForHoldingEvent(openingEvent.id);
  await syncHoldingPnlSnapshot(holding.id);

  return redirectWithMessage(req, `/holdings/${holding.id}`, "success", "Holding created successfully.");
}
