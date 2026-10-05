CREATE TABLE "cron_digests" (
	"run_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"item_count" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"message" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"lease_token" text,
	"lease_until" timestamp with time zone,
	"first_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_status" integer,
	"error_category" text,
	CONSTRAINT "cron_digests_run_id_user_id_pk" PRIMARY KEY("run_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "cron_run_items" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_name" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"media_type" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_run_sources" (
	"run_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "cron_run_sources_run_id_source_id_pk" PRIMARY KEY("run_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "cron_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"phase" text DEFAULT 'syncing' NOT NULL,
	"initialized" boolean DEFAULT false NOT NULL,
	"lease_token" text,
	"lease_until" timestamp with time zone,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cron_digests" ADD CONSTRAINT "cron_digests_run_id_cron_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."cron_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_digests" ADD CONSTRAINT "cron_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_run_items" ADD CONSTRAINT "cron_run_items_run_id_cron_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."cron_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_run_items" ADD CONSTRAINT "cron_run_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_run_sources" ADD CONSTRAINT "cron_run_sources_run_id_cron_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."cron_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_preferences" ADD CONSTRAINT "digest_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cron_run_items_run_user_idx" ON "cron_run_items" USING btree ("run_id","user_id");