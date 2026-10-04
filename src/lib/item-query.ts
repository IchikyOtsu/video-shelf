import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { items, itemStates, sources } from "@/db/schema";
import type { ContentType, LibraryView } from "./library";

export type ItemFilters = {
  view: LibraryView;
  sourceId: string;
  query: string;
  contentType: ContentType;
};

export const itemRead = sql<boolean>`coalesce(${itemStates.read}, false)`;
export const itemSaved = sql<boolean>`coalesce(${itemStates.saved}, false)`;

export function itemStateJoin(userId: string) {
  return and(eq(itemStates.itemId, items.id), eq(itemStates.userId, userId));
}

export function buildItemCondition(filters: ItemFilters, userId: string): SQL | undefined {
  const term = "%" + filters.query.replace(/[\\%_]/g, "\\$&") + "%";
  return and(
    eq(sources.userId, userId),
    filters.contentType === "all" ? undefined : eq(items.mediaType, filters.contentType),
    filters.sourceId ? eq(sources.id, filters.sourceId) : undefined,
    filters.view === "inbox" ? eq(itemRead, false) : filters.view === "archive" ? eq(itemRead, true) : filters.view === "saved" ? eq(itemSaved, true) : undefined,
    filters.query ? or(ilike(items.title, term), ilike(sources.name, term)) : undefined,
  );
}
