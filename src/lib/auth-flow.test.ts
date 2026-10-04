import assert from "node:assert/strict";
import { test } from "node:test";
import { authDestination, guestPageDestination, startLegacyMigration } from "./auth-flow";

test("successful signin navigates to the authenticated home", () => {
  assert.equal(authDestination(false), "/");
});

test("onboarding signin navigates to onboarding", () => {
  assert.equal(authDestination(true), "/onboarding");
});

test("TOTP success uses the same destination rules", () => {
  assert.equal(authDestination(false), "/");
  assert.equal(authDestination(true), "/onboarding");
});

test("slow or failing legacy migration does not delay authenticated rendering", async () => {
  const rendered: string[] = [];
  let rejectMigration: (reason?: unknown) => void = () => {};
  const migration = new Promise<void>((_, reject) => { rejectMigration = reject; });
  startLegacyMigration({ id: "user-1" }, account => rendered.push(account.id), () => migration, () => rendered.push("notice"));
  assert.deepEqual(rendered, ["user-1"]);
  rejectMigration(new Error("slow migration failed"));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(rendered, ["user-1", "notice"]);
});

test("authenticated user visiting signin is redirected", () => {
  assert.equal(guestPageDestination({ emailVerified: true, onboardingCompleted: true }), "/");
});

test("authenticated user visiting signup is redirected", () => {
  assert.equal(guestPageDestination({ emailVerified: true, onboardingCompleted: true }), "/");
});

test("authenticated user with incomplete onboarding is redirected to onboarding", () => {
  assert.equal(guestPageDestination({ emailVerified: false, onboardingCompleted: true }), "/onboarding");
  assert.equal(guestPageDestination({ emailVerified: true, onboardingCompleted: false }), "/onboarding");
});

test("fully onboarded authenticated user is redirected home", () => {
  assert.equal(guestPageDestination({ emailVerified: true, onboardingCompleted: true }), "/");
});
