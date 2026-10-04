import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAuthSecret } from "./auth";

test("production authentication fails clearly without AUTH_SECRET", () => {
  assert.throws(() => resolveAuthSecret(undefined, "production"), /AUTH_SECRET is required/);
});

test("development keeps a local fallback without exposing production secrets", () => {
  assert.ok(resolveAuthSecret(undefined, "development").byteLength > 0);
  assert.ok(resolveAuthSecret("configured", "production").byteLength > 0);
});
