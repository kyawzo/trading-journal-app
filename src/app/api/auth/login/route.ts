import { NextResponse } from "next/server";
import { createAuthSession, safeRedirectPath, verifyPassword } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

function redirectWithMessage(req: Request, tone: "success" | "error", message: string, nextPath?: string) {
  const url = new URL("/login", req.url);
  url.searchParams.set("tone", tone);
  url.searchParams.set("notice", message);

  if (nextPath) {
    url.searchParams.set("next", safeRedirectPath(nextPath, "/dashboard"));
  }

  return NextResponse.redirect(url);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const email = ((form.get("email") as string) || "").trim().toLowerCase();
  const password = ((form.get("password") as string) || "").trim();
  const nextPath = ((form.get("next") as string) || "/dashboard").trim();
  const safeNextPath = safeRedirectPath(nextPath, "/dashboard");

  if (!email || !password) {
    return redirectWithMessage(req, "error", "Email and password are required.", safeNextPath);
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    return redirectWithMessage(req, "error", "Email or password is incorrect.", safeNextPath);
  }

  await createAuthSession(user.id, { revokeCurrentSession: true });

  const shouldRouteToOnboarding = safeNextPath === "/dashboard" && (await prisma.brokerAccount.count({
    where: { userId: user.id },
  })) === 0;

  if (shouldRouteToOnboarding) {
    const onboardingUrl = new URL("/onboarding", req.url);
    onboardingUrl.searchParams.set("next", safeNextPath);
    return NextResponse.redirect(onboardingUrl);
  }

  return NextResponse.redirect(new URL(safeNextPath, req.url));
}

