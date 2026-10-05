import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { items, itemStates, sources } from "@/db/schema";
import type { ContentType, LibraryView, LibraryQuery } from "./library";

export type ItemFilters = {
  view: LibraryView;
  sourceId: string;
  query: string;
  contentType: ContentType;
  category?:string; status?:LibraryQuery["status"]; savedOnly?:boolean;
};

export const itemRead = sql<boolean>`coalesce(${itemStates.read}, false)`;
export const itemSaved = sql<boolean>`coalesce(${itemStates.saved}, false)`;

// A YouTube video imported without a publication date is not a new release.
// Keep RSS's existing import-time fallback, but put undated YouTube items last.
export function itemDateOrder(sort: "newest" | "oldest") {
  const date = sql`case when ${sources.kind} = 'youtube' then ${items.publishedAt} else coalesce(${items.publishedAt}, ${items.createdAt}) end`;
  return sort === "oldest" ? sql`${date} asc nulls last` : sql`${date} desc nulls last`;
}

export function itemStateJoin(userId: string) {
  // Some databases created before the unique constraint can contain an old
  // state plus a newer state for the same user/item. Joining only the newest
  // one keeps those legacy rows from rendering the item twice until migration.
  return and(
    eq(itemStates.itemId, items.id),
    eq(itemStates.userId, userId),
    sql`not exists (
      select 1 from "item_states" as "newer_item_state"
      where "newer_item_state"."user_id" = ${itemStates.userId}
        and "newer_item_state"."item_id" = ${itemStates.itemId}
        and (
          "newer_item_state"."updated_at" > ${itemStates.updatedAt}
          or ("newer_item_state"."updated_at" = ${itemStates.updatedAt} and "newer_item_state"."id" > ${itemStates.id})
        )
    )`,
  );
}

export function buildItemCondition(filters: ItemFilters, userId: string): SQL | undefined {
  const term = "%" + filters.query.replace(/[\\%_]/g, "\\$&") + "%";
  return and(
    eq(sources.userId, userId),
    filters.contentType === "all" ? undefined : eq(items.mediaType, filters.contentType),
    filters.sourceId ? eq(sources.id, filters.sourceId) : undefined,
    filters.view === "inbox" ? eq(itemRead, false) : filters.view === "archive" ? eq(itemRead, true) : filters.view === "saved" ? eq(itemSaved, true) : undefined,
    filters.category ? eq(sources.category,filters.category) : undefined,
    filters.savedOnly ? eq(itemSaved,true) : undefined,
    filters.status === "read" ? eq(itemRead,true) : filters.status === "unread" || filters.status === "in_progress" ? eq(itemRead,false) : undefined,
    filters.status === "in_progress" ? sql`coalesce(${itemStates.progressSeconds},0) > 0` : undefined,
    filters.query ? or(ilike(items.title, term), ilike(sources.name, term), ilike(items.author,term), ilike(items.summary,term), ilike(items.contentHtml,term), sql`exists (select 1 from article_documents doc where doc.item_id = ${items.id} and doc.html ilike ${term})`) : undefined,
  );
}
