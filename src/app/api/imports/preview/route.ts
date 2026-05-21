import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "@/src/lib/auth";
import { validateImportCurrencyMatch } from "@/src/lib/import-currency";
import { getBrokerImportAdapter, previewBrokerCsv } from "@/src/lib/imports/broker-dispatch";
import { prisma } from "@/src/lib/prisma";

const MAX_CSV_BYTES = 100 * 1024 * 1024;

function errorResponse(
  message: string,
  status = 400,
  extras?: Record<string, unknown>,
) {
  return NextResponse.json({ error: message, ...(extras ?? {}) }, { status });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, "/imports");
  }

  const formData = await req.formData();
  const brokerAccountId = String(formData.get("brokerAccountId") ?? "").trim();
  const file = formData.get("file");

  if (!brokerAccountId) {
    return errorResponse("Please choose a broker account.");
  }

  if (!(file instanceof File)) {
    return errorResponse("Please upload a CSV file.");
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    return errorResponse("Please upload a .csv file.");
  }

  if (file.size <= 0) {
    return errorResponse("CSV file is empty.");
  }

  if (file.size > MAX_CSV_BYTES) {
    return errorResponse("CSV file is too large. Maximum allowed size is 100MB.");
  }

  const brokerAccount = await prisma.brokerAccount.findFirst({
    where: {
      id: brokerAccountId,
      userId: user.id,
      isActive: true,
    },
    include: {
      broker: true,
    },
  });

  if (!brokerAccount) {
    return errorResponse("Broker account not found.", 404);
  }

  const adapter = getBrokerImportAdapter(brokerAccount.broker.brokerCode);
  if (!adapter?.previewImplemented) {
    return errorResponse(`${adapter?.displayName ?? brokerAccount.broker.brokerName} CSV import is not supported yet. ${adapter?.previewDescription ?? "Support will be added in an upcoming phase."}`);
  }

  const csvText = await file.text();
  const preview = await previewBrokerCsv({
    brokerAccount,
    fileName: file.name,
    csvText,
  });

  if (preview.missingRequiredColumns.length > 0) {
    return NextResponse.json({
      error: `CSV is missing required columns: ${preview.missingRequiredColumns.join(", ")}.`,
      missingRequiredColumns: preview.missingRequiredColumns,
      columns: preview.columns,
    }, { status: 400 });
  }

  const currencyValidation = validateImportCurrencyMatch({
    brokerAccountCurrency: brokerAccount.baseCurrency,
    detectedCurrencies: preview.summary.detectedCurrencies,
  });

  if (!currencyValidation.ok) {
    const detectedCurrency = preview.summary.detectedCurrencies[0] ?? null;
    const suggestedAccounts = detectedCurrency
      ? await prisma.brokerAccount.findMany({
          where: {
            userId: user.id,
            isActive: true,
            baseCurrency: detectedCurrency,
          },
          include: {
            broker: true,
          },
          orderBy: [{ createdAt: "desc" }],
          take: 5,
        })
      : [];

    return errorResponse(currencyValidation.message, 400, {
      code: "IMPORT_CURRENCY_MISMATCH",
      detectedCurrencies: preview.summary.detectedCurrencies,
      brokerAccountCurrency: brokerAccount.baseCurrency,
      suggestedBrokerAccounts: suggestedAccounts.map((account) => ({
        id: account.id,
        label: `${account.broker.brokerName} · ${account.accountName} · ${account.baseCurrency}`,
      })),
    });
  }

  return NextResponse.json({
    brokerAccount: {
      id: brokerAccount.id,
      accountName: brokerAccount.accountName,
      brokerName: brokerAccount.broker.brokerName,
      brokerCode: brokerAccount.broker.brokerCode,
      baseCurrency: brokerAccount.baseCurrency,
      importPreviewDescription: adapter.previewDescription,
    },
    fileName: file.name,
    ...preview,
  });
}
