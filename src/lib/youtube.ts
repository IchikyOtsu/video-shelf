export const youtubeChannelIdPattern = /^UC[A-Za-z0-9_-]{22}$/;

function youtubeUrl(input: string) {
  const value = input.trim();
  if (youtubeChannelIdPattern.test(value)) return `https://www.youtube.com/channel/${value}`;
  if (value.startsWith("@")) return `https://www.youtube.com/${value}`;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function decodeHtml(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export async function resolveYouTubeChannel(input: string) {
  let url = new URL(youtubeUrl(input));
  const allowedHosts = ["youtube.com", "www.youtube.com", "m.youtube.com"];
  if (!allowedHosts.includes(url.hostname)) throw new Error("Utilise une URL de chaîne YouTube.");
  const fromPath = url.pathname.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/i)?.[1] || url.searchParams.get("channel_id");
  let channelId = fromPath && youtubeChannelIdPattern.test(fromPath) ? fromPath : null;
  let page = "";
  {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (!allowedHosts.includes(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.port || url.username || url.password) throw new Error("Utilise une URL de chaîne YouTube.");
        response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", cookie: "SOCS=CAI" }, signal: controller.signal, redirect: "manual", cache: "no-store" });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        if (!location) break;
        url = new URL(location, url);
      }
      if (!response) throw new Error("YouTube est indisponible.");
      if (!response.ok) throw new Error("YouTube n’a pas trouvé cette chaîne.");
      page = await response.text();
    } finally { clearTimeout(timeout); }
    // Metadata identifies the owner; video recommendations can contain other channel IDs.
    channelId = channelId || page.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/)?.[1] || page.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/)?.[1] || null;
  }
  if (!channelId) throw new Error("Impossible de trouver le flux de cette chaîne. Essaie l’URL youtube.com/@nom ou youtube.com/channel/UC…");
  const title = page.match(/<meta property="og:title" content="([^"]+)"/i)?.[1];
  return { channelId, name: title ? decodeHtml(title) : null, siteUrl: `https://www.youtube.com/channel/${channelId}`, feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}` };
}

export type ChannelResult = { channelId: string; name: string; imageUrl: string | null; description: string };

// YouTube embeds a JSON document in search pages. Only channel renderers are used.
export function parseChannelResults(page: string): ChannelResult[] {
  const json = page.match(/(?:var ytInitialData\s*=|window\["ytInitialData"\]\s*=)\s*({[\s\S]*?});\s*<\/script>/)?.[1];
  if (!json) throw new Error("La recherche YouTube est indisponible. Essaie un @handle ou une URL de chaîne.");
  const results = new Map<string, ChannelResult>();
  const text = (value: { simpleText?: string; runs?: { text: string }[] } | undefined) => value?.simpleText || value?.runs?.map(run => run.text).join("") || "";
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.channelRenderer) {
      const channel = node.channelRenderer as { channelId: string; title?: { simpleText?: string; runs?: { text: string }[] }; descriptionSnippet?: { runs: { text: string }[] }; thumbnail?: { thumbnails: { url: string }[] } };
      if (youtubeChannelIdPattern.test(channel.channelId)) results.set(channel.channelId, { channelId: channel.channelId, name: text(channel.title), description: text(channel.descriptionSnippet), imageUrl: channel.thumbnail?.thumbnails.at(-1)?.url?.replace(/^\/\//, "https://") || null });
    }
    for (const child of Object.values(node)) visit(child);
  }
  visit(JSON.parse(json));
  return [...results.values()].slice(0, 8);
}

export async function searchYouTubeChannels(input: string): Promise<ChannelResult[]> {
  const query = input.trim();
  if (query.startsWith("@") || youtubeChannelIdPattern.test(query) || /^(https?:\/\/|(?:www\.|m\.)?youtube\.com\/)/i.test(query)) {
    const channel = await resolveYouTubeChannel(query);
    return [{ channelId: channel.channelId, name: channel.name || channel.channelId, imageUrl: null, description: channel.siteUrl }];
  }
  if (process.env.YOUTUBE_API_KEY) {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.search = new URLSearchParams({ part: "snippet", type: "channel", maxResults: "8", q: query, key: process.env.YOUTUBE_API_KEY }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 300 } });
    if (!response.ok) throw new Error("La recherche YouTube est indisponible. Essaie un @handle ou une URL de chaîne.");
    const data = await response.json();
    return (data.items || []).map((item: { snippet: { channelId: string; title: string; description: string; thumbnails?: { default?: { url: string } } } }) => ({ channelId: item.snippet.channelId, name: decodeHtml(item.snippet.title), description: decodeHtml(item.snippet.description), imageUrl: item.snippet.thumbnails?.default?.url || null }));
  }
  const url = new URL("https://www.youtube.com/results");
  url.search = new URLSearchParams({ search_query: query, sp: "EgIQAg==", hl: "fr" }).toString();
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", "accept-language": "fr,en;q=0.8", cookie: "SOCS=CAI" }, signal: AbortSignal.timeout(8000), next: { revalidate: 300 } });
  if (!response.ok) throw new Error("YouTube est temporairement indisponible. Réessaie dans un instant.");
  return parseChannelResults(await response.text());
}
