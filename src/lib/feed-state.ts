import type { FeedItem, LibraryPage, LibraryView } from "./library";

export type ItemStateChange = { read?: boolean; saved?: boolean };

export function itemMatchesView(item: FeedItem, view: LibraryView) {
  if (view === "inbox") return !item.read;
  if (view === "archive") return item.read;
  if (view === "saved") return item.saved;
  return true;
}

export function applyOptimisticItemState(page: LibraryPage, ids: Iterable<string>, fields: ItemStateChange, view: LibraryView) {
  const targets = new Set(ids);
  let removed = 0;
  let added = 0;
  const counts = { ...page.counts };
  const nextItems: FeedItem[] = [];
  for (const item of page.items) {
    if (!targets.has(item.id)) { nextItems.push(item); continue; }
    const updated = { ...item, ...fields };
    if (fields.read !== undefined && fields.read !== item.read) {
      counts.inbox += fields.read ? -1 : 1;
      counts.archive += fields.read ? 1 : -1;
    }
    if (fields.saved !== undefined && fields.saved !== item.saved) counts.saved += fields.saved ? 1 : -1;
    const before = itemMatchesView(item, view);
    const after = itemMatchesView(updated, view);
    if (before && !after) removed++;
    if (!before && after) added++;
    if (after) nextItems.push(updated);
  }
  return {
    ...page,
    items: nextItems,
    total: Math.max(0, page.total - removed + added),
    nextOffset: page.nextOffset === null ? null : Math.max(0, page.nextOffset - removed + added),
    counts,
  };
}

export function toggleSelection(selection: Set<string>, id: string) {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

export function pruneSelection(selection: Set<string>, visibleItems: FeedItem[]) {
  const visible = new Set(visibleItems.map(item => item.id));
  return new Set([...selection].filter(id => visible.has(id)));
}
