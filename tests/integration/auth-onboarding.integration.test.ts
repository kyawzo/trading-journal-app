import "dotenv/config";

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, beforeEach, describe, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Client as PgClient } from "pg";

const APP_PORT = 3101;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const TEST_TIMEOUT_MS = 120_000;

type RequestOptions = {
  method?: string;
  form?: Record<string, string>;
  jar?: CookieJar;
  redirect?: RequestRedirect;
};

class CookieJar {
  private readonly values = new Map<string, string>();

  toHeader() {
    return Array.from(this.values.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  capture(response: Response) {
    const responseHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookieHeaders = responseHeaders.getSetCookie?.() ?? [];

    if (setCookieHeaders.length > 0) {
      for (const setCookie of setCookieHeaders) {
        this.captureSingle(setCookie);
      }
      return;
    }

    const fallback = response.headers.get("set-cookie");
    if (fallback) {
      this.captureSingle(fallback);
    }
  }

  private captureSingle(setCookie: string) {
    const [cookiePart] = setCookie.split(";");
    const separatorIndex = cookiePart.indexOf("=");

    if (separatorIndex <= 0) {
      return;
    }

    const name = cookiePart.slice(0, separatorIndex).trim();
    const value = cookiePart.slice(separatorIndex + 1).trim();

    if (name) {
      this.values.set(name, value);
    }
  }
}

const testDatabaseUrl = resolveTestDatabaseUrl();
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
});

let nextDevProcess: ReturnType<typeof spawn> | null = null;

function resolveTestDatabaseUrl() {
  const explicit = process.env.TEST_DATABASE_URL?.trim();

  if (explicit) {
    if (process.env.DATABASE_URL && explicit === process.env.DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL must not match DATABASE_URL.");
    }

    return explicit;
  }

  const baseUrl = process.env.DATABASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("Set TEST_DATABASE_URL (recommended) or DATABASE_URL before running integration tests.");
  }

  const parsed = new URL(baseUrl);
  const databaseName = parsed.pathname.replace(/^\//, "");
  const derivedName = databaseName.endsWith("_test") ? databaseName : `${databaseName}_test`;
  parsed.pathname = `/${derivedName}`;
  return parsed.toString();
}

function ensureSafeTestDatabaseName(connectionString: string) {
  const parsed = new URL(connectionString);
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();

  if (!dbName.includes("test")) {
    throw new Error(`Refusing to run integration tests on non-test database: ${dbName}`);
  }
}

async function ensureDatabaseExists(connectionString: string) {
  const target = new URL(connectionString);
  const databaseName = target.pathname.replace(/^\//, "");
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";

  const adminClient = new PgClient({ connectionString: adminUrl.toString() });
  await adminClient.connect();

  try {
    const existing = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);

    if (existing.rowCount === 0) {
      const escapedDbName = `"${databaseName.replace(/"/g, "\"\"")}"`;
      await adminClient.query(`CREATE DATABASE ${escapedDbName}`);
    }
  } finally {
    await adminClient.end();
  }
}

function runCommand(commandLine: string, env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(commandLine, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed (${commandLine})\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}

async function waitForServerReady(url: string, timeoutMs: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/login`, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Next.js server did not become ready within ${timeoutMs}ms.`);
}

async function truncateAllTables(connectionString: string) {
  const client = new PgClient({ connectionString });
  await client.connect();

  try {
    const tablesResult = await client.query<{ tablename: string }>(
      `
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '_prisma_migrations'
      `,
    );

    if (tablesResult.rows.length === 0) {
      return;
    }

    const joined = tablesResult.rows.map((row) => `"${row.tablename}"`).join(", ");
    await client.query(`TRUNCATE TABLE ${joined} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end();
  }
}

function getLocationPath(location: string | null) {
  assert.ok(location, "Expected redirect location header.");
  const resolved = new URL(location, APP_URL);
  return `${resolved.pathname}${resolved.search}`;
}


function getNoticeFromPath(path: string) {
  return new URL(path, APP_URL).searchParams.get("notice");
}
async function send(path: string, options: RequestOptions = {}) {
  const method = options.method ?? (options.form ? "POST" : "GET");
  const headers = new Headers();

  if (options.jar) {
    const cookieHeader = options.jar.toHeader();
    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
  }

  let body: string | undefined;
  if (options.form) {
    body = new URLSearchParams(options.form).toString();
    headers.set("content-type", "application/x-www-form-urlencoded");
  }

  const response = await fetch(`${APP_URL}${path}`, {
    method,
    headers,
    body,
    redirect: options.redirect ?? "manual",
  });

  if (options.jar) {
    options.jar.capture(response);
  }

  return response;
}

type SignedUpUser = {
  email: string;
  password: string;
  jar: CookieJar;
  userId: string;
};

async function signUpUser(label: string): Promise<SignedUpUser> {
  const email = `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = "Passw0rd!123";
  const jar = new CookieJar();

  const response = await send("/api/auth/signup", {
    form: {
      displayName: label,
      email,
      password,
      confirmPassword: password,
      next: "/dashboard",
    },
    jar,
  });

  assert.equal(response.status, 307);
  const locationPath = getLocationPath(response.headers.get("location"));
  assert.ok(locationPath.startsWith("/onboarding?next=%2Fdashboard"));

  const user = await prisma.user.findUnique({ where: { email } });
  assert.ok(user, "Expected user to be created after signup.");

  return {
    email,
    password,
    jar,
    userId: user.id,
  };
}

async function loginUser(email: string, password: string) {
  const jar = new CookieJar();

  const response = await send("/api/auth/login", {
    form: {
      email,
      password,
      next: "/dashboard",
    },
    jar,
  });

  return { response, jar };
}
describe("Integration Suite: Auth + Onboarding + Authorization", { concurrency: 1 }, () => {
  before(async () => {
    ensureSafeTestDatabaseName(testDatabaseUrl);
    await ensureDatabaseExists(testDatabaseUrl);

    const npxCommand = "npx";
    const commandEnv = {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
    };

    await runCommand(`${npxCommand} prisma db push --accept-data-loss`, commandEnv);
    await runCommand(`${npxCommand} next build`, commandEnv);

    const spawnedProcess = spawn(`${npxCommand} next start -p ${String(APP_PORT)}`, {
      cwd: process.cwd(),
      shell: true,
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
        PORT: String(APP_PORT),
        NODE_ENV: "development",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    nextDevProcess = spawnedProcess;

    spawnedProcess.stdout.on("data", () => {
      // Keep pipe drained; omit noisy logs from test output.
    });

    spawnedProcess.stderr.on("data", () => {
      // Keep pipe drained; omit noisy logs from test output.
    });

    await waitForServerReady(APP_URL, TEST_TIMEOUT_MS);
  });

  after(async () => {
    await prisma.$disconnect();

    if (!nextDevProcess) {
      return;
    }

    nextDevProcess.kill();
    await new Promise<void>((resolve) => {
      nextDevProcess?.once("exit", () => resolve());
      setTimeout(() => resolve(), 5_000);
    });
  });

  beforeEach(async () => {
    await truncateAllTables(testDatabaseUrl);
  });

  test("signup success redirects to onboarding", { timeout: TEST_TIMEOUT_MS }, async () => {
    const user = await signUpUser("signup-success");

    const onboarding = await send("/onboarding", { jar: user.jar, redirect: "follow" });
    const html = await onboarding.text();

    assert.equal(onboarding.status, 200);
    assert.match(html, /Create your first broker account/i);
  });

  test("signup duplicate email is rejected with friendly message", { timeout: TEST_TIMEOUT_MS }, async () => {
    const first = await signUpUser("signup-duplicate");

    const secondJar = new CookieJar();
    const second = await send("/api/auth/signup", {
      form: {
        displayName: "Duplicate",
        email: first.email,
        password: "Passw0rd!123",
        confirmPassword: "Passw0rd!123",
        next: "/dashboard",
      },
      jar: secondJar,
    });

    assert.equal(second.status, 307);
    const locationPath = getLocationPath(second.headers.get("location"));
    assert.match(locationPath, /^\/signup\?/);
    assert.equal(getNoticeFromPath(locationPath), "An account already exists for that email.");
  });

  test("signup invalid password is rejected", { timeout: TEST_TIMEOUT_MS }, async () => {
    const jar = new CookieJar();
    const response = await send("/api/auth/signup", {
      form: {
        displayName: "Bad Password",
        email: `bad.pass.${Date.now()}@example.com`,
        password: "short",
        confirmPassword: "short",
        next: "/dashboard",
      },
      jar,
    });

    assert.equal(response.status, 307);
    const locationPath = getLocationPath(response.headers.get("location"));
    assert.match(locationPath, /^\/signup\?/);
    assert.equal(getNoticeFromPath(locationPath), "Password must be at least 8 characters.");
  });

  test("login success routes user without broker account to onboarding", { timeout: TEST_TIMEOUT_MS }, async () => {
    const signed = await signUpUser("login-success");

    const logout = await send("/api/auth/logout", { method: "POST", jar: signed.jar });
    assert.equal(logout.status, 307);

    const { response } = await loginUser(signed.email, signed.password);
    assert.equal(response.status, 307);
    const locationPath = getLocationPath(response.headers.get("location"));
    assert.ok(locationPath.startsWith("/onboarding?next=%2Fdashboard"));
  });

  test("login wrong password returns generic error", { timeout: TEST_TIMEOUT_MS }, async () => {
    const signed = await signUpUser("login-wrong-password");

    const logout = await send("/api/auth/logout", { method: "POST", jar: signed.jar });
    assert.equal(logout.status, 307);

    const { response } = await loginUser(signed.email, "WrongPassword!123");
    assert.equal(response.status, 307);

    const locationPath = getLocationPath(response.headers.get("location"));
    assert.match(locationPath, /^\/login\?/);
    assert.equal(getNoticeFromPath(locationPath), "Email or password is incorrect.");
  });

  test("logout clears session and redirects to login", { timeout: TEST_TIMEOUT_MS }, async () => {
    const signed = await signUpUser("logout-success");

    const logout = await send("/api/auth/logout", { method: "POST", jar: signed.jar });
    assert.equal(logout.status, 307);
    assert.match(getLocationPath(logout.headers.get("location")), /^\/login\?/);

    const dashboard = await send("/dashboard", { jar: signed.jar });
    assert.equal(dashboard.status, 307);
    assert.match(getLocationPath(dashboard.headers.get("location")), /^\/login\?next=%2Fdashboard/);
  });

  test("unauthenticated portal page redirects to login", { timeout: TEST_TIMEOUT_MS }, async () => {
    const response = await send("/dashboard");
    assert.equal(response.status, 307);
    assert.match(getLocationPath(response.headers.get("location")), /^\/login\?next=%2Fdashboard/);
  });

  test("unauthenticated protected API redirects to login", { timeout: TEST_TIMEOUT_MS }, async () => {
    const response = await send("/api/positions", {
      form: {
        symbol: "AAPL",
        strategy: "LONG_CALL",
      },
    });

    assert.equal(response.status, 307);
    assert.match(getLocationPath(response.headers.get("location")), /^\/login\?next=%2Fpositions%2Fnew/);
  });

  test("onboarding creates first broker account, sets active broker, and creates opening balance deposit", { timeout: TEST_TIMEOUT_MS }, async () => {
    const signed = await signUpUser("onboarding-flow");

    const createAccount = await send("/api/broker-accounts", {
      form: {
        brokerCode: "MANUAL",
        accountName: "Integration Primary",
        accountType: "MARGIN",
        baseCurrency: "USD",
        openingBalance: "10000",
        setAsActive: "true",
        errorRedirectTo: "/onboarding?next=%2Fdashboard",
        successRedirectTo: "/dashboard",
      },
      jar: signed.jar,
    });

    assert.equal(createAccount.status, 307);
    const locationPath = getLocationPath(createAccount.headers.get("location"));
    assert.match(locationPath, /^\/dashboard\?/);
    assert.equal(getNoticeFromPath(locationPath), "Broker account and opening balance created successfully.");

    const brokerAccount = await prisma.brokerAccount.findFirst({
      where: { userId: signed.userId, accountName: "Integration Primary" },
    });
    assert.ok(brokerAccount, "Expected broker account to be created during onboarding.");

    const preference = await prisma.userPreference.findUnique({
      where: { userId: signed.userId },
    });
    assert.equal(preference?.activeBrokerAccountId, brokerAccount.id);

    const openingDeposit = await prisma.cashLedger.findFirst({
      where: {
        brokerAccountId: brokerAccount.id,
        txnType: "DEPOSIT",
      },
    });
    assert.ok(openingDeposit, "Expected opening balance deposit row.");
    assert.equal(openingDeposit?.amount.toString(), "10000");
  });

  test("user isolation: user A cannot read or mutate user B position", { timeout: TEST_TIMEOUT_MS }, async () => {
    const userB = await signUpUser("user-b-owner");

    const createAccount = await send("/api/broker-accounts", {
      form: {
        brokerCode: "MANUAL",
        accountName: "B Account",
        accountType: "MARGIN",
        baseCurrency: "USD",
        setAsActive: "true",
        errorRedirectTo: "/broker-accounts",
        successRedirectTo: "/dashboard",
      },
      jar: userB.jar,
    });
    assert.equal(createAccount.status, 307);

    const createPosition = await send("/api/positions", {
      form: {
        symbol: "TSLA",
        strategy: "LONG_CALL",
      },
      jar: userB.jar,
    });

    assert.equal(createPosition.status, 307);
    const positionLocation = getLocationPath(createPosition.headers.get("location"));
    const positionIdMatch = positionLocation.match(/^\/positions\/([^/?#]+)/);
    assert.ok(positionIdMatch, `Expected position redirect path, got: ${positionLocation}`);
    const bPositionId = positionIdMatch[1];

    const userA = await signUpUser("user-a-other");

    const readAttempt = await send(`/positions/${bPositionId}`, {
      jar: userA.jar,
      redirect: "manual",
    });
    assert.equal(readAttempt.status, 404);

    const mutateAttempt = await send(`/api/positions/${bPositionId}/journal`, {
      form: {
        thesis: "Hacked thesis",
        entryPlan: "Hacked entry",
        exitPlan: "Hacked exit",
        tradeNotes: "Hacked notes",
      },
      jar: userA.jar,
    });

    assert.equal(mutateAttempt.status, 307);
    const mutationLocation = getLocationPath(mutateAttempt.headers.get("location"));
    assert.match(mutationLocation, new RegExp(`^/positions/${bPositionId}\\?`));
    assert.equal(getNoticeFromPath(mutationLocation), "Position not found.");

    const bPosition = await prisma.position.findUnique({ where: { id: bPositionId } });
    assert.equal(bPosition?.thesis, null);
    assert.equal(bPosition?.entryPlan, null);
    assert.equal(bPosition?.exitPlan, null);
    assert.equal(bPosition?.tradeNotes, null);
  });
});




