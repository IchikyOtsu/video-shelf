const channelIdPattern = /^UC[A-Za-z0-9_-]{22}$/;

function youtubeUrl(input: string) {
  const value = input.trim();
  if (channelIdPattern.test(value)) return `https://www.youtube.com/channel/${value}`;
  if (value.startsWith("@")) return `https://www.youtube.com/${value}`;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function decodeHtml(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export async function resolveYouTubeChannel(input: string) {
  const url = new URL(youtubeUrl(input));
  const allowedHosts = ["youtube.com", "www.youtube.com", "m.youtube.com"];
  if (!allowedHosts.includes(url.hostname)) throw new Error("Utilise une URL de chaîne YouTube.");
  const fromPath = url.pathname.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/i)?.[1] || url.searchParams.get("channel_id");
  let channelId = fromPath && channelIdPattern.test(fromPath) ? fromPath : null;
  let page = "";
  if (!channelId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; Shelf/1.0)" }, signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("YouTube n’a pas trouvé cette chaîne.");
      page = await response.text();
    } finally { clearTimeout(timeout); }
    channelId = page.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/)?.[1] || page.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/)?.[1] || page.match(/"browseId":"(UC[A-Za-z0-9_-]{22})"/)?.[1] || null;
  }
  if (!channelId) throw new Error("Impossible de trouver le flux de cette chaîne. Essaie l’URL youtube.com/@nom ou youtube.com/channel/UC…");
  const title = page.match(/<meta property="og:title" content="([^"]+)"/i)?.[1];
  return { channelId, name: title ? decodeHtml(title) : null, siteUrl: `https://www.youtube.com/channel/${channelId}`, feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}` };
}
