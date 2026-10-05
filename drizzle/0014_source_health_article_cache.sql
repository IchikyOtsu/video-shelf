CREATE TABLE "article_documents" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"html" text,
	"fetched_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"retry_after" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cron_run_sources" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "failure_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_failure_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "article_documents" ADD CONSTRAINT "article_documents_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_run_sources" ADD CONSTRAINT "cron_run_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
UPDATE "cron_run_sources" c SET "user_id" = s."user_id" FROM "sources" s WHERE c."source_id" = s."id" AND c."user_id" IS NULL;
