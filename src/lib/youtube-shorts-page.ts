import { fetchSourceText, SourceFetchError } from "./source-fetch";
import { youtubeChannelIdPattern } from "./youtube";

type Node = Record<string, unknown>;
const object = (value: unknown): Node => value && typeof value === "object" && !Array.isArray(value) ? value as Node : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const headers = { "user-agent": "Mozilla/5.0", "accept-language": "en-US,en;q=0.9", cookie: "SOCS=CAI" };
const invalid = () => new SourceFetchError("INVALID_RESPONSE", "www.youtube.com");
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
const prefix = "shorts-tab:";

// Inspect only the verified Shorts grid or its continuation, never recommendations.
export function parseShortsGrid(contents: unknown[]) {
  const ids = new Set<string>();
  let token: string | undefined;
  function walk(value: unknown) {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const node = object(value);
    const watch = object(node.reelWatchEndpoint);
    if (validId(watch.videoId)) ids.add(watch.videoId);
    const reel = object(node.reelItemRenderer);
    if (validId(reel.videoId)) ids.add(reel.videoId);
    const lockup = object(node.shortsLockupViewModel);
    const endpoint = object(object(object(lockup.onTap).innertubeCommand).reelWatchEndpoint);
    if (validId(endpoint.videoId)) ids.add(endpoint.videoId);
    // New Shorts lockups sometimes expose their ID only through the entity ID.
    if (typeof lockup.entityId === "string" && lockup.entityId.startsWith("shorts-shelf-item-")) {
      const id = lockup.entityId.slice("shorts-shelf-item-".length);
      if (validId(id)) ids.add(id);
    }
    const continuation = object(object(object(node.continuationItemRenderer).continuationEndpoint).continuationCommand).token;
    if (typeof continuation === "string" && continuation.length && continuation.length <= 12_000) token = continuation;
    Object.values(node).forEach(walk);
  }
  contents.forEach(walk);
  if (contents.length && !ids.size && !token && !contents.some(item => object(item).messageRenderer)) throw invalid();
  return { ids: [...ids], token };
}

export function parseShortsPage(html: string, channel: string) {
  const json = html.match(/(?:var ytInitialData\s*=|window\["ytInitialData"\]\s*=)\s*({[\s\S]*?});\s*<\/script>/)?.[1];
  if (!json) throw invalid();
  let root: Node;
  try { root = object(JSON.parse(json)); } catch { throw invalid(); }
  if (object(object(root.metadata).channelMetadataRenderer).externalId !== channel) throw invalid();
  const tabs = list(object(object(root.contents).twoColumnBrowseResultsRenderer).tabs).map(tab => object(object(tab).tabRenderer));
  const selected = tabs.find(tab => tab.selected === true);
  if (!selected) throw invalid();
  const isShorts = (tab: Node) => {
    const path = object(object(object(tab.endpoint).commandMetadata).webCommandMetadata).url;
    if (typeof path === "string") {
      try { const url = new URL(path,"https://www.youtube.com"); return url.hostname === "www.youtube.com" && /\/shorts\/?$/.test(url.pathname); } catch { return false; }
    }
    return tab.title === "Shorts";
  };
  // YouTube redirects channels without a Shorts tab to their regular channel.
  if (!isShorts(selected)) { if (!tabs.some(isShorts)) return { ids: [] as string[] }; throw invalid(); }
  const grid = object(object(selected.content).richGridRenderer);
  if (!Array.isArray(grid.contents)) throw invalid();
  const result = parseShortsGrid(grid.contents);
  const version = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([0-9.]+)"/)?.[1];
  if (result.token && !version) throw invalid();
  return { ...result, version };
}

// One page per source per user-triggered batch; the UI continues through cursors.
// No Data API quota or per-video classification requests are used here.
export async function fetchShortsTab(channel: string, cursor?: string): Promise<{ ids: string[]; nextPageToken?: string }> {
  if (!youtubeChannelIdPattern.test(channel)) throw invalid();
  let continuation: { token: string; version: string } | undefined;
  if (cursor?.startsWith(prefix)) {
    try {
      const data = object(JSON.parse(cursor.slice(prefix.length)));
      if (data.channel !== channel || typeof data.token !== "string" || !data.token.length || data.token.length > 12_000 || typeof data.version !== "string" || !/^[0-9.]{1,64}$/.test(data.version)) throw invalid();
      continuation = { token: data.token, version: data.version };
    } catch { throw invalid(); }
  }
  // Legacy Data API cursors restart at the tab's first page.
  let result: { ids: string[]; token?: string; version?: string };
  if (!continuation) {
    const response = await fetchSourceText(`https://www.youtube.com/channel/${channel}/shorts`, headers, 10_000, 8_000_000);
    result = parseShortsPage(response.text, channel);
  } else {
    const payload = JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: continuation.version } }, continuation: continuation.token });
    const response = await fetchSourceText("https://www.youtube.com/youtubei/v1/browse", headers, 10_000, 8_000_000, (input, init) => fetch(input, { ...init, method: "POST", headers: { ...headers, "content-type": "application/json" }, body: payload }));
    let root: Node;
    try { root = object(JSON.parse(response.text)); } catch { throw invalid(); }
    const actions = [...list(root.onResponseReceivedActions), ...list(root.onResponseReceivedEndpoints)];
    const pages = actions.map(action => object(object(action).appendContinuationItemsAction)).filter(action => Array.isArray(action.continuationItems));
    if (!pages.length) throw invalid();
    result = { ...parseShortsGrid(pages.flatMap(page => list(page.continuationItems))), version: continuation.version };
    if (result.token === continuation.token) throw invalid();
  }
  return { ids: result.ids, ...(result.token ? { nextPageToken: prefix + JSON.stringify({ channel, token: result.token, version: result.version }) } : {}) };
}
