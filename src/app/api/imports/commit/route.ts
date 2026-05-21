import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "@/src/lib/auth";
import { validateImportCurrencyMatch } from "@/src/lib/import-currency";
import { commitBrokerCsv, getBrokerImportAdapter, previewBrokerCsv } from "@/src/lib/imports/broker-dispatch";
import { prisma } from "@/src/lib/prisma";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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
  if (!adapter?.commitImplemented) {
    return errorResponse(`${adapter?.displayName ?? brokerAccount.broker.brokerName} CSV import is not supported yet. ${adapter?.previewDescription ?? "Support will be added in an upcoming phase."}`);
  }

  try {
    const csvText = await file.text();
    const preview = await previewBrokerCsv({
      brokerAccount,
      fileName: file.name,
      csvText,
    });

    if (preview.missingRequiredColumns.length > 0) {
      return errorResponse(`CSV is missing required columns: ${preview.missingRequiredColumns.join(", ")}.`);
    }

    const currencyValidation = validateImportCurrencyMatch({
      brokerAccountCurrency: brokerAccount.baseCurrency,
      detectedCurrencies: preview.summary.detectedCurrencies,
    });

    if (!currencyValidation.ok) {
      return errorResponse(currencyValidation.message);
    }

    const result = await commitBrokerCsv({
      brokerAccount,
      fileName: file.name,
      csvText,
    });

    return NextResponse.json({
      brokerAccount: {
        id: brokerAccount.id,
        accountName: brokerAccount.accountName,
        brokerName: brokerAccount.broker.brokerName,
      },
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed due to an unexpected error.";
    const status = message.includes("already imported") ? 409 : 400;
    return errorResponse(message, status);
  }
}
