ALTER TABLE "sources" ADD COLUMN "content_type" text DEFAULT 'article' NOT NULL;--> statement-breakpoint
UPDATE "sources" SET "content_type" = 'video' WHERE "kind" = 'youtube';--> statement-breakpoint
CREATE UNIQUE INDEX "sources_user_feed_unique" ON "sources" USING btree ("user_id","feed_url");
