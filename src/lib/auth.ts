import { type User } from "@prisma/client";
import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { safeRedirectPath } from "./security";

const scrypt = promisify(nodeScrypt);
const SESSION_COOKIE_NAME = "trading_journal_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function toBuffer(value: string) {
  return Buffer.from(value, "hex");
}

export function getAuthCookieName() {
  return SESSION_COOKIE_NAME;
}

export { safeRedirectPath, safeRedirectPathFromReferer } from "./security";

export function buildLoginPath(nextPath = "/dashboard") {
  const loginPath = new URLSearchParams({ next: safeRedirectPath(nextPath) });
  return `/login?${loginPath.toString()}`;
}

export function redirectToLogin(nextPath = "/dashboard") {
  redirect(buildLoginPath(nextPath));
}

export function redirectToLoginResponse(req: Request, nextPath = "/dashboard") {
  return NextResponse.redirect(new URL(buildLoginPath(nextPath), req.url));
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [salt, storedKey] = passwordHash.split(":");

  if (!salt || !storedKey) {
    return false;
  }

  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const storedKeyBuffer = toBuffer(storedKey);

  if (derivedKey.length !== storedKeyBuffer.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, storedKeyBuffer);
}

export async function getCurrentSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function getCurrentSession() {
  const sessionToken = await getCurrentSessionToken();

  if (!sessionToken) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { sessionToken },
    include: { user: true },
  });

  if (!session || session.expiresAt <= new Date() || !session.user.isActive) {
    await prisma.session.deleteMany({
      where: { sessionToken },
    });

    return null;
  }

  return session;
}

export async function getCurrentUser() {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

export async function requireCurrentUser(nextPath = "/dashboard"): Promise<User> {
  const user = await getCurrentUser();

  if (!user) {
    redirectToLogin(nextPath);
    throw new Error("Unreachable after redirectToLogin");
  }

  return user;
}

type CreateAuthSessionOptions = {
  revokeAllForUser?: boolean;
  revokeCurrentSession?: boolean;
};

export async function createAuthSession(userId: string, options?: CreateAuthSessionOptions) {
  const sessionToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const currentSessionToken = await getCurrentSessionToken();

  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({
      where: {
        expiresAt: {
          lte: new Date(),
        },
      },
    });

    if (options?.revokeAllForUser) {
      await tx.session.deleteMany({
        where: { userId },
      });
    } else if (options?.revokeCurrentSession && currentSessionToken) {
      await tx.session.deleteMany({
        where: {
          userId,
          sessionToken: currentSessionToken,
        },
      });
    }

    await tx.session.create({
      data: {
        userId,
        sessionToken,
        expiresAt,
      },
    });
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });

  return { sessionToken, expiresAt };
}

export async function destroyAuthSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionToken) {
    await prisma.session.deleteMany({
      where: { sessionToken },
    });
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}
