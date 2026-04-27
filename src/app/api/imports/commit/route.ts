import { BrokerCode } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "@/src/lib/auth";
import { importMoomooCsv } from "@/src/lib/moomoo-import/importer";
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

  if (brokerAccount.broker.brokerCode !== BrokerCode.MOOMOO) {
    return errorResponse("Only MooMoo CSV import is supported right now.");
  }

  try {
    const result = await importMoomooCsv({
      brokerAccountId: brokerAccount.id,
      fileName: file.name,
      csvText: await file.text(),
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
