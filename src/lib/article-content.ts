import { Parser } from "htmlparser2";

export function contentUrl(value: unknown, base: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const result = new URL(value.trim(), base);
    return ["http:", "https:"].includes(result.protocol) && !result.username && !result.password ? result.toString() : null;
  } catch { return null; }
}

const hidden = new Set(["script", "style", "noscript", "template", "svg"]);
const breaks = new Set(["p", "div", "br", "li", "h1", "h2", "h3", "h4", "blockquote", "tr"]);

// Extract plain text and image candidates; never render publisher HTML.
export function articleContent(html: string, base: string) {
  const chunks: string[] = [];
  const images: string[] = [];
  let ignored = 0;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (hidden.has(name)) ignored++;
      if (ignored) return;
      if (breaks.has(name)) chunks.push(" ");
      if (name !== "img") return;
      if ((attrs.width && Number(attrs.width) <= 5) || (attrs.height && Number(attrs.height) <= 5)) return;
      const variants = (attrs["data-srcset"] || attrs.srcset || "").split(",").map(part => {
        const [src, descriptor] = part.trim().split(/\s+/);
        return { src, size: Number.parseFloat(descriptor || "0") || 0 };
      }).sort((a, b) => b.size - a.size);
      const src = [attrs["data-src"], attrs["data-lazy-src"], ...variants.map(image => image.src), attrs.src].map(value => contentUrl(value, base)).find(Boolean);
      if (src && !images.includes(src)) images.push(src);
    },
    ontext(value) { if (!ignored) chunks.push(value); },
    onclosetag(name) {
      if (hidden.has(name)) ignored = Math.max(0, ignored - 1);
      if (!ignored && breaks.has(name)) chunks.push(" ");
    },
  }, { decodeEntities: true });
  parser.end(html);
  return { text: chunks.join("").replace(/\s+/g, " ").trim(), images };
}

export function articlePreview(summary: string | null, url: string, imageUrl: string | null, feedUrl?: string) {
  const content = articleContent(summary || "", url);
  const words = content.text.split(/\s+/).filter(Boolean).length;
  const excerpt = content.text.length > 320 ? content.text.slice(0, 320).replace(/\s+\S*$/, "") + "…" : content.text;
  return {
    summary: excerpt || null,
    imageUrl: contentUrl(imageUrl === feedUrl ? null : imageUrl, url) || content.images[0] || null,
    // Short snippets cannot provide a useful estimate of the whole article.
    readingMinutes: words >= 200 ? Math.ceil(words / 220) : null,
  };
}
