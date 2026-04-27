import { BrokerCode } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "@/src/lib/auth";
import { parseMoomooCsvPreview } from "@/src/lib/moomoo-import/parser";
import { prisma } from "@/src/lib/prisma";

const MAX_CSV_BYTES = 100 * 1024 * 1024;

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

  if (brokerAccount.broker.brokerCode !== BrokerCode.MOOMOO) {
    return errorResponse("Only MooMoo CSV import is supported right now. Other brokers will be added in upcoming phases.");
  }

  const csvText = await file.text();
  const preview = parseMoomooCsvPreview(csvText);

  if (preview.missingRequiredColumns.length > 0) {
    return NextResponse.json({
      error: `CSV is missing required columns: ${preview.missingRequiredColumns.join(", ")}.`,
      missingRequiredColumns: preview.missingRequiredColumns,
      columns: preview.columns,
    }, { status: 400 });
  }

  return NextResponse.json({
    brokerAccount: {
      id: brokerAccount.id,
      accountName: brokerAccount.accountName,
      brokerName: brokerAccount.broker.brokerName,
      brokerCode: brokerAccount.broker.brokerCode,
    },
    fileName: file.name,
    ...preview,
  });
}
