export type LibraryView = "inbox" | "all" | "saved" | "archive";
export type ContentType = "all" | "video" | "article" | "podcast";
export type FeedItem = {
  id: string; title: string; url: string; audioUrl?: string | null; imageUrl: string | null;
  publishedAt: string | null; sourceName: string; sourceId: string;
  summary: string | null; mediaType: string; sourceKind: string; read: boolean; saved: boolean;
  progressSeconds: number; durationSeconds: number | null; lastPlayedAt: string | null;
};
export type LibraryCounts = Record<LibraryView, number>;
export type LibraryPage = {
  items: FeedItem[]; total: number; nextOffset: number | null; counts: LibraryCounts;
};
export const libraryViews = {
  inbox: { label: "Nouveautés", icon: "▣" },
  all: { label: "Bibliothèque", icon: "▤" },
  saved: { label: "Enregistrés", icon: "♡" },
  archive: { label: "Vues", icon: "✓" },
} as const;
export const contentTypes = {
  all: { label: "Tous", icon: "◫" },
  video: { label: "Vidéos", icon: "▷" },
  article: { label: "Articles", icon: "≡" },
  podcast: { label: "Podcasts", icon: "◉" },
} as const;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseLibraryQuery(params: URLSearchParams) {
  const view = params.get("view") || "inbox";
  const sourceId = params.get("source") || "";
  const offset = Number(params.get("offset") || 0);
  const sort = params.get("sort") || "newest";
  if (sort !== "newest" && sort !== "oldest") throw new Error("Filtres invalides.");
  const query = (params.get("q") || "").trim();
  const contentType = params.get("type") || "all";
  if (!(view in libraryViews) || !Object.hasOwn(libraryViews, view) || !(contentType in contentTypes) || !Object.hasOwn(contentTypes, contentType) || (sourceId && !uuidPattern.test(sourceId)) || !Number.isSafeInteger(offset) || offset < 0 || query.length > 200) throw new Error("Filtres invalides.");
  return { view: view as LibraryView, sourceId, offset, sort, query, contentType: contentType as ContentType };
}

export function parseStateChange(body: unknown): { ids: string[]; read?: boolean; saved?: boolean } {
  if (!body || typeof body !== "object") throw new Error("Modification invalide.");
  const value = body as Record<string, unknown>;
  if (!Array.isArray(value.ids) || !value.ids.length || value.ids.length > 100 || value.ids.some(id => typeof id !== "string" || !uuidPattern.test(id)) ||
    (value.read === undefined && value.saved === undefined) ||
    (value.read !== undefined && typeof value.read !== "boolean") ||
    (value.saved !== undefined && typeof value.saved !== "boolean")) throw new Error("Modification invalide.");
  return { ids: [...new Set(value.ids as string[])], ...(value.read !== undefined ? { read: value.read as boolean } : {}), ...(value.saved !== undefined ? { saved: value.saved as boolean } : {}) };
}

export type InboxGroup = { label: "Aujourd’hui" | "Hier" | "Plus ancien"; items: FeedItem[] };

export function groupInboxItems(items: FeedItem[], now = new Date()): InboxGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 24 * 60 * 60 * 1000;
  const groups: InboxGroup[] = [
    { label: "Aujourd’hui", items: [] },
    { label: "Hier", items: [] },
    { label: "Plus ancien", items: [] },
  ];
  for (const item of items) {
    const published = item.publishedAt ? new Date(item.publishedAt) : null;
    const day = published && !Number.isNaN(published.getTime())
      ? new Date(published.getFullYear(), published.getMonth(), published.getDate()).getTime()
      : Number.NEGATIVE_INFINITY;
    groups[day >= today ? 0 : day >= yesterday ? 1 : 2].items.push(item);
  }
  return groups.filter(group => group.items.length);
}
