import { BrokerAccountType, BrokerCode, CashTxnType } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse, safeRedirectPath } from "@/src/lib/auth";
import { normalizeCashLedgerAmount } from "@/src/lib/cash-ledger";
import { prisma } from "@/src/lib/prisma";
import { getWorkspacePreference } from "@/src/lib/workspace-preference";

const BROKER_LABELS: Record<BrokerCode, string> = {
  MOOMOO: "MooMoo",
  TIGER: "Tiger",
  IBKR: "Interactive Brokers",
  TASTYTRADE: "tastytrade",
  WEBULL: "Webull",
  MANUAL: "Manual Broker",
  OTHER: "Other",
};

function redirectWithMessage(
  req: Request,
  tone: "success" | "error",
  message: string,
  redirectPath = "/broker-accounts",
) {
  const url = new URL(safeRedirectPath(redirectPath, "/broker-accounts"), req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);
  return NextResponse.redirect(url);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, "/broker-accounts");
  }

  const form = await req.formData();

  const brokerCode = ((form.get("brokerCode") as string) || "").trim().toUpperCase();
  const accountName = ((form.get("accountName") as string) || "").trim();
  const accountType = ((form.get("accountType") as string) || BrokerAccountType.OTHER).trim().toUpperCase();
  const accountNumberMasked = ((form.get("accountNumberMasked") as string) || "").trim();
  const baseCurrency = ((form.get("baseCurrency") as string) || "USD").trim().toUpperCase();
  const openedAtRaw = ((form.get("openedAt") as string) || "").trim();
  const openingBalanceRaw = ((form.get("openingBalance") as string) || "").trim();
  const notes = ((form.get("notes") as string) || "").trim();
  const setAsActive = form.get("setAsActive") === "on" || form.get("setAsActive") === "true";
  const errorRedirectTo = ((form.get("errorRedirectTo") as string) || "/broker-accounts").trim();
  const successRedirectTo = ((form.get("successRedirectTo") as string) || "/broker-accounts").trim();

  if (!Object.values(BrokerCode).includes(brokerCode as BrokerCode)) {
    return redirectWithMessage(req, "error", "Please choose a valid broker.", errorRedirectTo);
  }

  if (!Object.values(BrokerAccountType).includes(accountType as BrokerAccountType)) {
    return redirectWithMessage(req, "error", "Please choose a valid account type.", errorRedirectTo);
  }

  if (!accountName) {
    return redirectWithMessage(req, "error", "Account name is required.", errorRedirectTo);
  }

  const openedAt = openedAtRaw ? new Date(openedAtRaw) : null;
  if (openedAtRaw && Number.isNaN(openedAt?.getTime())) {
    return redirectWithMessage(req, "error", "Opened at date is invalid.", errorRedirectTo);
  }

  const openingBalance = openingBalanceRaw ? Number(openingBalanceRaw) : null;
  if (openingBalanceRaw && (!Number.isFinite(openingBalance) || openingBalance === null || openingBalance <= 0)) {
    return redirectWithMessage(req, "error", "Opening balance must be a valid positive number.", errorRedirectTo);
  }

  const workspace = await getWorkspacePreference();
  const parsedBrokerCode = brokerCode as BrokerCode;
  const parsedAccountType = accountType as BrokerAccountType;

  await prisma.$transaction(async (tx) => {
    const broker = await tx.broker.upsert({
      where: { brokerCode: parsedBrokerCode },
      update: {
        brokerName: BROKER_LABELS[parsedBrokerCode],
      },
      create: {
        brokerCode: parsedBrokerCode,
        brokerName: BROKER_LABELS[parsedBrokerCode],
      },
    });

    const brokerAccount = await tx.brokerAccount.create({
      data: {
        brokerId: broker.id,
        userId: user.id,
        accountName,
        accountType: parsedAccountType,
        accountNumberMasked: accountNumberMasked || null,
        baseCurrency,
        openedAt,
        notes: notes || null,
      },
    });

    if (openingBalance !== null) {
      await tx.cashLedger.create({
        data: {
          brokerAccountId: brokerAccount.id,
          txnType: CashTxnType.DEPOSIT,
          txnTimestamp: openedAt ?? new Date(),
          amount: normalizeCashLedgerAmount(CashTxnType.DEPOSIT, openingBalance).toString(),
          currency: baseCurrency,
          description: "Opening balance",
        },
      });
    }

    if (setAsActive || !workspace.activeBrokerAccountId) {
      await tx.userPreference.upsert({
        where: { userId: user.id },
        update: {
          activeBrokerAccountId: brokerAccount.id,
        },
        create: {
          userId: user.id,
          activeBrokerAccountId: brokerAccount.id,
        },
      });
    }
  });

  return redirectWithMessage(
    req,
    "success",
    openingBalance !== null
      ? "Broker account and opening balance created successfully."
      : "Broker account created successfully.",
    successRedirectTo,
  );
}
