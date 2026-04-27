import { CashTxnType } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "@/src/lib/auth";
import { normalizeCashLedgerAmount } from "@/src/lib/cash-ledger";
import { prisma } from "@/src/lib/prisma";
import { getWorkspacePreference } from "@/src/lib/workspace-preference";

function redirectWithMessage(req: Request, tone: "success" | "error", message: string) {
  const url = new URL("/cash-ledger", req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);
  return NextResponse.redirect(url);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, "/cash-ledger");
  }

  const form = await req.formData();
  const workspace = await getWorkspacePreference();

  if (!workspace.activeBrokerAccountId) {
    return redirectWithMessage(req, "error", "Choose an active broker account before adding a cash ledger entry.");
  }

  const brokerAccount = await prisma.brokerAccount.findFirst({
    where: {
      id: workspace.activeBrokerAccountId,
      userId: user.id,
    },
  });

  if (!brokerAccount || !brokerAccount.isActive) {
    return redirectWithMessage(req, "error", "The active broker account is unavailable. Please choose another account.");
  }

  const txnType = ((form.get("txnType") as string) || "").trim().toUpperCase();
  const amountRaw = ((form.get("amount") as string) || "").trim();
  const currency = ((form.get("currency") as string) || brokerAccount.baseCurrency || "USD").trim().toUpperCase();
  const txnTimestampRaw = ((form.get("txnTimestamp") as string) || "").trim();
  const description = ((form.get("description") as string) || "").trim();

  if (!Object.values(CashTxnType).includes(txnType as CashTxnType)) {
    return redirectWithMessage(req, "error", "Please choose a valid cash transaction type.");
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount === 0) {
    return redirectWithMessage(req, "error", "Amount must be a valid non-zero number.");
  }

  const txnTimestamp = txnTimestampRaw ? new Date(txnTimestampRaw) : new Date();
  if (Number.isNaN(txnTimestamp.getTime())) {
    return redirectWithMessage(req, "error", "Transaction time is invalid.");
  }

  const parsedTxnType = txnType as CashTxnType;
  const normalizedAmount = normalizeCashLedgerAmount(parsedTxnType, amount);

  await prisma.cashLedger.create({
    data: {
      brokerAccountId: brokerAccount.id,
      txnType: parsedTxnType,
      txnTimestamp,
      amount: normalizedAmount.toString(),
      currency,
      description: description || null,
    },
  });

  return redirectWithMessage(req, "success", "Cash ledger entry added successfully.");
}
