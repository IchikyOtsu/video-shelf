import { boolean, index, integer, jsonb, primaryKey, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", { id: uuid("id").defaultRandom().primaryKey(), email: text("email").notNull().unique(), name: text("name"), passwordHash: text("password_hash").notNull(), emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }), totpEnabled: boolean("totp_enabled").notNull().default(false), totpSecretEncrypted: text("totp_secret_encrypted"), sessionVersion: integer("session_version").notNull().default(0), onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() });
export const emailVerificationTokens = pgTable("email_verification_tokens", { id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(), tokenHash: text("token_hash").notNull().unique(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), usedAt: timestamp("used_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (t) => [index("email_verification_tokens_user_idx").on(t.userId)]);
export const passwordResetTokens = pgTable("password_reset_tokens", { id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(), tokenHash: text("token_hash").notNull().unique(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), usedAt: timestamp("used_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (t) => [index("password_reset_tokens_user_idx").on(t.userId)]);
export const recoveryCodes = pgTable("recovery_codes", { id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(), codeHash: text("code_hash").notNull().unique(), usedAt: timestamp("used_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (t) => [index("recovery_codes_user_idx").on(t.userId)]);
export const authRateLimits = pgTable("auth_rate_limits", { key: text("key").primaryKey(), count: integer("count").notNull().default(0), windowStartedAt: timestamp("window_started_at", { withTimezone: true }).defaultNow().notNull() });
export const sources = pgTable("sources", { id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(), name: text("name").notNull(), feedUrl: text("feed_url").notNull(), siteUrl: text("site_url"), imageUrl: text("image_url"), kind: text("kind").notNull().default("rss"), contentType: text("content_type").notNull().default("article"), category: text("category").notNull().default("Unsorted"), active: boolean("active").notNull().default(true), lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }), lastSyncError: text("last_sync_error"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (t) => [index("sources_user_id_idx").on(t.userId), uniqueIndex("sources_user_feed_unique").on(t.userId, t.feedUrl)]);
export const items = pgTable("items", { id: uuid("id").defaultRandom().primaryKey(), sourceId: uuid("source_id").references(() => sources.id, { onDelete: "cascade" }).notNull(), guid: text("guid").notNull(), title: text("title").notNull(), url: text("url").notNull(), audioUrl: text("audio_url"), summary: text("summary"), author: text("author"), mediaType: text("media_type").notNull().default("article"), duration: text("duration"), imageUrl: text("image_url"), publishedAt: timestamp("published_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (t) => [index("items_source_published_idx").on(t.sourceId, t.publishedAt), uniqueIndex("items_source_guid_unique").on(t.sourceId, t.guid)]);
export const itemStates = pgTable("item_states", { id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(), itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }).notNull(), saved: boolean("saved").notNull().default(false), read: boolean("read").notNull().default(false), readLater: boolean("read_later").notNull().default(false), progressSeconds: integer("progress_seconds").notNull().default(0), durationSeconds: integer("duration_seconds"), lastPlayedAt: timestamp("last_played_at", { withTimezone: true }), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull() }, (t) => [index("item_states_user_id_idx").on(t.userId), uniqueIndex("item_states_user_item_unique").on(t.userId, t.itemId)]);


// Missing preference rows mean enabled, including existing accounts.
export const digestPreferences = pgTable("digest_preferences", {
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
});
export const cronRuns = pgTable("cron_runs", {
  id: text("id").primaryKey(), phase: text("phase").notNull().default("syncing"),
  initialized: boolean("initialized").notNull().default(false),
  leaseToken: text("lease_token"), leaseUntil: timestamp("lease_until", { withTimezone: true }),
  summary: jsonb("summary").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const cronRunSources = pgTable("cron_run_sources", {
  runId: text("run_id").references(() => cronRuns.id, { onDelete: "cascade" }).notNull(),
  sourceId: uuid("source_id").notNull(), status: text("status").notNull().default("pending"),
}, t => [primaryKey({ columns: [t.runId, t.sourceId] })]);
export const cronRunItems = pgTable("cron_run_items", {
  // Snapshot records survive item/source removal; account removal cascades.
  itemId: uuid("item_id").primaryKey(), runId: text("run_id").references(() => cronRuns.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  sourceId: uuid("source_id").notNull(), sourceName: text("source_name").notNull(),
  title: text("title").notNull(), url: text("url").notNull(), mediaType: text("media_type").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("cron_run_items_run_user_idx").on(t.runId, t.userId)]);
export const cronDigests = pgTable("cron_digests", {
  runId: text("run_id").references(() => cronRuns.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  recipient: text("recipient").notNull(), itemCount: integer("item_count").notNull(),
  payload: jsonb("payload").notNull(), message: jsonb("message"),
  status: text("status").notNull().default("pending"), leaseToken: text("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }), sentAt: timestamp("sent_at", { withTimezone: true }),
  providerStatus: integer("provider_status"), errorCategory: text("error_category"),
}, t => [primaryKey({ columns: [t.runId, t.userId] })]);
