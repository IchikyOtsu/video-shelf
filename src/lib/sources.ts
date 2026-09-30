import { syncYouTubeSource } from "./feed";

// Source providers own importing; the library and reading states are format-independent.
const providers = { youtube: syncYouTubeSource };
export function syncSource(source: { id: string; kind: string; feedUrl: string }) {
  const provider = Object.hasOwn(providers, source.kind) ? providers[source.kind as keyof typeof providers] : undefined;
  if (!provider) throw new Error("Ce type de source ne peut pas encore être actualisé.");
  return provider(source);
}
