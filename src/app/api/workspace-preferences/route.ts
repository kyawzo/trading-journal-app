import { ThemeMode } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, redirectToLoginResponse, safeRedirectPathFromReferer } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

function redirectToReferer(req: Request, fallbackPath: string, tone?: "success" | "error", notice?: string) {
  const referer = req.headers.get("referer");
  const path = safeRedirectPathFromReferer(referer, req.url, fallbackPath);
  const url = new URL(path, req.url);

  if (tone && notice) {
    url.searchParams.set("tone", tone);
    url.searchParams.set("notice", notice);
  }

  return NextResponse.redirect(url);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectToLoginResponse(req, "/settings");
  }

  const form = await req.formData();
  const intent = ((form.get("intent") as string) || "").trim();

  if (intent === "set-theme") {
    const themeMode = ((form.get("themeMode") as string) || ThemeMode.LIGHT).trim().toUpperCase();

    if (!Object.values(ThemeMode).includes(themeMode as ThemeMode)) {
      return redirectToReferer(req, "/settings", "error", "Theme mode is invalid.");
    }

    await prisma.userPreference.update({
      where: { userId: user.id },
      data: { themeMode: themeMode as ThemeMode },
    });

    return redirectToReferer(req, "/settings", "success", "Theme updated successfully.");
  }

  if (intent === "set-active-broker") {
    const brokerAccountId = ((form.get("brokerAccountId") as string) || "").trim();

    const brokerAccount = await prisma.brokerAccount.findFirst({
      where: {
        id: brokerAccountId,
        userId: user.id,
      },
    });

    if (!brokerAccount || !brokerAccount.isActive) {
      return redirectToReferer(req, "/broker-accounts", "error", "Please choose one of your active broker accounts.");
    }

    await prisma.userPreference.update({
      where: { userId: user.id },
      data: { activeBrokerAccountId: brokerAccount.id },
    });

    return redirectToReferer(req, "/dashboard", "success", "Active broker updated successfully.");
  }

  return redirectToReferer(req, "/settings", "error", "Unknown workspace preference action.");
}
