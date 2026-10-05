import sanitizeHtml from "sanitize-html";
import { articleContent, contentUrl } from "./article-content";

export type ReaderContent = { html: string; kind: "full" | "summary" | "missing" };
const blocked = ["script", "style", "iframe", "object", "embed", "svg", "math", "canvas", "form", "noscript", "template", "audio", "video"];
export function sanitizeArticleHtml(input: string, base: string): string {
  return sanitizeHtml(input, {
    allowedTags: ["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "a", "blockquote", "strong", "em", "b", "i", "u", "s", "del", "pre", "code", "hr", "figure", "figcaption", "img", "table", "thead", "tbody", "tr", "th", "td", "div", "span", "sup", "sub", "caption", "tfoot", "dl", "dt", "dd", "kbd", "mark", "abbr"],
    allowedAttributes: { a: ["href", "title", "target", "rel"], td:["colspan", "rowspan"], th:["colspan", "rowspan", "scope"], abbr:["title"], ol:["start"], li:["value"], img: ["src", "alt", "title", "loading", "decoding", "referrerpolicy"] },
    allowedSchemes: ["http", "https"], allowProtocolRelative: false, nonTextTags: blocked,
    transformTags: {
      "*": (tagName, attrs) => {
        const safeAttrs = { ...attrs };
        for (const key of ["colspan", "rowspan", "start", "value"]) if (safeAttrs[key] && (!/^\d{1,4}$/.test(safeAttrs[key]) || Number(safeAttrs[key]) < 1)) delete safeAttrs[key];
        if (safeAttrs.scope && !["row","col","rowgroup","colgroup"].includes(safeAttrs.scope)) delete safeAttrs.scope;
        return ({ tagName: Object.hasOwn(attrs, "hidden") || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style || "") ? "template" : tagName, attribs: safeAttrs }); },
      a: (_tag, attrs) => ({ tagName: "a", attribs: { href: contentUrl(attrs.href, base) || "", title: attrs.title || "", target: "_blank", rel: "noopener noreferrer" } }),
      img: (_tag, attrs) => {
        const hidden = (attrs.width && Number(attrs.width) <= 5) || (attrs.height && Number(attrs.height) <= 5) || /(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s|;|$))/i.test(attrs.style || "");
        const variants = (attrs["data-srcset"] || attrs.srcset || "").split(",").map(part => {
          const [src, size] = part.trim().split(/\s+/); return { src, size: Number.parseFloat(size || "0") || 0 };
        }).sort((a, b) => b.size - a.size);
        const src = hidden ? null : [attrs["data-src"], attrs["data-lazy-src"], ...variants.map(value => value.src), attrs.src].map(value => contentUrl(value, base)).find(Boolean);
        const tracking = src && /(?:^|[\/_.-])(?:pixel|tracking|beacon|spacer)(?:[\/_.?-]|$)/i.test(new URL(src).pathname);
        return { tagName: "img", attribs: { src: !tracking && src || "", alt: attrs.alt || "", title: attrs.title || "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" } };
      },
    },
    exclusiveFilter: frame => frame.tag === "img" && !frame.attribs.src,
  });
}
export function readerContent(item: { contentHtml?: string | null; summary: string | null; url: string }): ReaderContent {
  const full = sanitizeArticleHtml(item.contentHtml || "", item.url);
  const useful = (html: string) => Boolean(articleContent(html, item.url).text || /<img\s/.test(html));
  if (useful(full)) return { html: full, kind: "full" };
  const summary = sanitizeArticleHtml(item.summary || "", item.url);
  if (!useful(summary)) return { kind: "missing", html: "" };
  // xkcd publishes the complete comic in RSS description, without content:encoded.
  // Do not infer that arbitrary descriptions or thumbnail images are full articles.
  try {
    const url = new URL(item.url);
    const comicPage = ["xkcd.com", "www.xkcd.com"].includes(url.hostname) && /^\/\d+\/?$/.test(url.pathname);
    const comicImage = articleContent(summary, item.url).images.some(src => {
      const image = new URL(src);
      return image.hostname === "imgs.xkcd.com" && image.pathname.startsWith("/comics/");
    });
    if (comicPage && comicImage) return { html: summary, kind: "full" };
  } catch { /* Generic excerpts remain excerpts. */ }
  return { html: summary, kind: "summary" };
}
