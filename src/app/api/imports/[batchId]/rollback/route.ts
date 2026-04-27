import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "@/src/lib/auth";
import { rollbackImportBatchForUser } from "@/src/lib/import-rollback";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type Params = {
  params: Promise<{
    batchId: string;
  }>;
};

export async function POST(req: Request, { params }: Params) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, "/imports");
  }

  const { batchId } = await params;
  const normalizedBatchId = batchId.trim();

  if (!normalizedBatchId) {
    return errorResponse("Import batch id is required.");
  }

  try {
    const result = await rollbackImportBatchForUser(user.id, normalizedBatchId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rollback failed due to an unexpected error.";
    const status = message === "Import batch not found."
      ? 404
      : message.startsWith("Rollback is currently blocked") || message.includes("cannot be undone automatically")
        ? 409
        : 400;

    return errorResponse(message, status);
  }
}
