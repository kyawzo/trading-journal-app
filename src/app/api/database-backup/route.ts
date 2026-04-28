import { NextResponse } from "next/server";
import { createPostgresBackup } from "@/src/lib/database-backup";
import { getCurrentUser, redirectToLoginResponse } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

function redirectWithMessage(req: Request, tone: "success" | "error", message: string) {
  const url = new URL("/settings", req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);
  return NextResponse.redirect(url);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, "/settings");
  }

  const preference = await prisma.userPreference.findUnique({
    where: { userId: user.id },
    select: { backupFolderPath: true },
  });

  const backupFolderPath = preference?.backupFolderPath?.trim();
  if (!backupFolderPath) {
    return redirectWithMessage(req, "error", "Set a backup folder path before running a backup.");
  }

  try {
    const result = await createPostgresBackup(backupFolderPath);
    return redirectWithMessage(req, "success", `Database backup created: ${result.fileName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database backup failed.";
    return redirectWithMessage(req, "error", message);
  }
}
