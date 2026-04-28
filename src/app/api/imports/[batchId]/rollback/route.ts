import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse } from "@/src/lib/auth";
import { rollbackImportBatchForUser } from "@/src/lib/import-rollback";

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isRollbackConflict(message: string) {
  return (
    message.startsWith("Rollback is currently blocked") ||
    message.includes("cannot be undone automatically") ||
    message.includes("not created by this import batch") ||
    message.includes("cannot be deleted safely") ||
    message.includes("no pre-import history") ||
    message.includes("newer events after this import batch") ||
    message.includes("has non-import events") ||
    message.includes("has cash ledger entries not created") ||
    message.includes("is linked to positions not created")
  );
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
      : isRollbackConflict(message)
        ? 409
        : 400;

    return errorResponse(message, status);
  }
}
