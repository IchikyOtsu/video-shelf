export type LibraryView = "inbox" | "all" | "saved" | "archive";
export type FeedItem = {
  id: string; title: string; url: string; imageUrl: string | null;
  publishedAt: string | null; sourceName: string; sourceId: string;
  mediaType: string; sourceKind: string; read: boolean; saved: boolean;
};
export type LibraryCounts = Record<LibraryView, number>;
export type LibraryPage = {
  items: FeedItem[]; total: number; nextOffset: number | null; counts: LibraryCounts;
};
export const libraryViews = {
  inbox: { label: "Boîte de réception", icon: "▣", description: "Les nouvelles vidéos de tes sources, à découvrir à ton rythme." },
  all: { label: "Bibliothèque", icon: "▤", description: "Tous les contenus collectés, des dernières nouveautés aux anciens flux." },
  saved: { label: "À retrouver", icon: "♡", description: "Tes contenus enregistrés, toujours à portée de main." },
  archive: { label: "Archives", icon: "✓", description: "Les vidéos déjà traitées. Elles restent disponibles dans ta bibliothèque." },
} as const;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseLibraryQuery(params: URLSearchParams) {
  const view = params.get("view") || "inbox";
  const sourceId = params.get("source") || "";
  const offset = Number(params.get("offset") || 0);
  const sort = params.get("sort") || "newest";
  const query = (params.get("q") || "").trim();
  const mediaType = params.get("type") || "video";
  if (!(view in libraryViews) || !Object.hasOwn(libraryViews, view) || (sourceId && !uuidPattern.test(sourceId)) || !Number.isSafeInteger(offset) || offset < 0 || !["newest", "oldest"].includes(sort) || query.length > 200 || mediaType !== "video") throw new Error("Filtres invalides.");
  return { view: view as LibraryView, sourceId, offset, sort, query, mediaType };
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
