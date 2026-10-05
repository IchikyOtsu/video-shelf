import { safeMediaUrl } from "./item-opening";
export class SourceEditError extends Error {}
export type SourceEdit = { name: string; feedUrl: string; siteUrl: string; imageUrl: string; category: string };
export function parseSourceEdit(body: unknown): SourceEdit {
  if (!body || typeof body !== "object") throw new SourceEditError("Réglages de source invalides.");
  const value = body as Record<string, unknown>;
  const result = {} as SourceEdit;
  for (const key of ["name", "feedUrl", "siteUrl", "imageUrl", "category"] as const) {
    if (typeof value[key] !== "string" || value[key].length > (key.endsWith("Url") ? 2048 : key === "category" ? 80 : 200)) throw new SourceEditError("Réglages de source invalides.");
    result[key] = value[key].trim();
  }
  if (!result.feedUrl) throw new SourceEditError("Le lien du flux est obligatoire.");
  for (const key of ["feedUrl", "siteUrl", "imageUrl"] as const) if (result[key] && !safeMediaUrl(result[key])) throw new SourceEditError("Utilise des liens HTTP ou HTTPS sans identifiants.");
  return result;
}
export async function resolveSourceEdit(edit: SourceEdit, source: { feedUrl: string; contentType: string }, inspect: (url: string) => Promise<{ name: string | null; feedUrl?: string; siteUrl: string | null; imageUrl: string | null; contentType: string }>) {
  const auto = edit.feedUrl !== source.feedUrl || !edit.name || !edit.siteUrl || !edit.imageUrl;
  const metadata = auto ? await inspect(edit.feedUrl) : null;
  return { name: edit.name || metadata?.name || new URL(edit.feedUrl).hostname, feedUrl: metadata?.feedUrl || edit.feedUrl,
    siteUrl: edit.siteUrl || safeMediaUrl(metadata?.siteUrl), imageUrl: edit.imageUrl || safeMediaUrl(metadata?.imageUrl),
    category: edit.category || "Non classé", contentType: metadata?.contentType || source.contentType };
}
