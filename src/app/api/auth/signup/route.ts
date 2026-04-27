import { Prisma, ThemeMode } from "@prisma/client";
import { NextResponse } from "next/server";
import { createAuthSession, safeRedirectPath } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { isValidEmail } from "@/src/lib/security";

function redirectWithMessage(req: Request, tone: "success" | "error", message: string, nextPath?: string) {
  const url = new URL("/signup", req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);

  if (nextPath) {
    url.searchParams.set("next", safeRedirectPath(nextPath, "/dashboard"));
  }

  return NextResponse.redirect(url);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const displayName = ((form.get("displayName") as string) || "").trim();
  const email = ((form.get("email") as string) || "").trim().toLowerCase();
  const password = ((form.get("password") as string) || "").trim();
  const confirmPassword = ((form.get("confirmPassword") as string) || "").trim();
  const nextPath = ((form.get("next") as string) || "/dashboard").trim();
  const safeNextPath = safeRedirectPath(nextPath, "/dashboard");

  if (!email) {
    return redirectWithMessage(req, "error", "Email is required.", safeNextPath);
  }

  if (!isValidEmail(email)) {
    return redirectWithMessage(req, "error", "Please enter a valid email address.", safeNextPath);
  }

  if (password.length < 8) {
    return redirectWithMessage(req, "error", "Password must be at least 8 characters.", safeNextPath);
  }

  if (password !== confirmPassword) {
    return redirectWithMessage(req, "error", "Password confirmation does not match.", safeNextPath);
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    return redirectWithMessage(req, "error", "An account already exists for that email.", safeNextPath);
  }

  const { hashPassword } = await import("@/src/lib/auth");
  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email,
          displayName: displayName || null,
          passwordHash,
        },
      });

      await tx.userPreference.create({
        data: {
          userId: createdUser.id,
          themeMode: ThemeMode.LIGHT,
        },
      });

      return createdUser;
    });

    await createAuthSession(user.id);
    const onboardingUrl = new URL("/onboarding", req.url);
    onboardingUrl.searchParams.set("next", safeNextPath);
    return NextResponse.redirect(onboardingUrl);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return redirectWithMessage(req, "error", "An account already exists for that email.", safeNextPath);
    }

    throw error;
  }
}
