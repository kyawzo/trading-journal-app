import { NextResponse } from "next/server";
import {
  createAuthSession,
  getCurrentUser,
  hashPassword,
  redirectToLoginResponse,
  verifyPassword,
} from "@/src/lib/auth";
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

  const form = await req.formData();
  const intent = ((form.get("intent") as string) || "").trim();

  if (intent === "update-profile") {
    const displayName = ((form.get("displayName") as string) || "").trim();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        displayName: displayName || null,
      },
    });

    return redirectWithMessage(req, "success", "Account profile updated successfully.");
  }

  if (intent === "change-password") {
    const currentPassword = ((form.get("currentPassword") as string) || "").trim();
    const newPassword = ((form.get("newPassword") as string) || "").trim();
    const confirmPassword = ((form.get("confirmPassword") as string) || "").trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      return redirectWithMessage(req, "error", "Current password, new password, and confirmation are required.");
    }

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return redirectWithMessage(req, "error", "Current password is incorrect.");
    }

    if (newPassword.length < 8) {
      return redirectWithMessage(req, "error", "New password must be at least 8 characters.");
    }

    if (newPassword !== confirmPassword) {
      return redirectWithMessage(req, "error", "New password confirmation does not match.");
    }

    if (currentPassword === newPassword) {
      return redirectWithMessage(req, "error", "Choose a new password that is different from the current password.");
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
      },
    });

    await createAuthSession(user.id, { revokeAllForUser: true });

    return redirectWithMessage(req, "success", "Password updated successfully. Other sessions were signed out.");
  }

  return redirectWithMessage(req, "error", "Unsupported account settings action.");
}
