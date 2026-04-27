import assert from "node:assert/strict";
import test from "node:test";
import { isValidEmail, safeRedirectPath, safeRedirectPathFromReferer } from "../src/lib/security";

test("safeRedirectPath allows local absolute paths", () => {
  assert.equal(safeRedirectPath("/dashboard"), "/dashboard");
  assert.equal(safeRedirectPath("/positions/new?mode=quick"), "/positions/new?mode=quick");
});

test("safeRedirectPath falls back for invalid or unsafe paths", () => {
  const fallback = "/dashboard";

  assert.equal(safeRedirectPath(undefined, fallback), fallback);
  assert.equal(safeRedirectPath("", fallback), fallback);
  assert.equal(safeRedirectPath("https://evil.example", fallback), fallback);
  assert.equal(safeRedirectPath("//evil.example", fallback), fallback);
  assert.equal(safeRedirectPath("/\\evil", fallback), fallback);
  assert.equal(safeRedirectPath("/login\\evil", fallback), fallback);
  assert.equal(safeRedirectPath("/login\nSet-Cookie:bad=1", fallback), fallback);
});

test("safeRedirectPathFromReferer only accepts same-origin referer", () => {
  const reqUrl = "https://app.local/settings";

  assert.equal(
    safeRedirectPathFromReferer("https://app.local/broker-accounts?tone=success", reqUrl, "/settings"),
    "/broker-accounts?tone=success",
  );

  assert.equal(
    safeRedirectPathFromReferer("https://evil.local/broker-accounts", reqUrl, "/settings"),
    "/settings",
  );

  assert.equal(
    safeRedirectPathFromReferer("not-a-url", reqUrl, "/settings"),
    "/settings",
  );
});

test("isValidEmail accepts common valid addresses", () => {
  assert.equal(isValidEmail("user@example.com"), true);
  assert.equal(isValidEmail("trader.ops+alerts@sub.domain.co"), true);
});

test("isValidEmail rejects malformed addresses", () => {
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail("no-at-symbol"), false);
  assert.equal(isValidEmail("user@domain"), false);
  assert.equal(isValidEmail("user @example.com"), false);
});
