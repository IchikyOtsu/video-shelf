import { sql } from "drizzle-orm";
import { items } from "../db/schema";

// Sparse RSS/page backups must not erase richer API metadata. No state columns
// or identity columns belong in this update, even on initial-import retries.
export function metadataUpdateSet() {
  return {
    title: sql`coalesce(nullif(excluded."title", ''), ${items.title})`,
    imageUrl: sql`coalesce(nullif(excluded."image_url", ''), ${items.imageUrl})`,
    author: sql`coalesce(nullif(excluded."author", ''), ${items.author})`,
    summary: sql`coalesce(nullif(excluded."summary", ''), ${items.summary})`,
    duration: sql`coalesce(nullif(excluded."duration", ''), ${items.duration})`,
    contentHtml: sql`coalesce(nullif(excluded."content_html", ''), ${items.contentHtml})`,
    publishedAt: sql`coalesce(excluded."published_at", ${items.publishedAt})`,
  };
}
