ALTER TABLE "item_states" ADD COLUMN "progress_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "item_states" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "item_states" ADD COLUMN "last_played_at" timestamp with time zone;