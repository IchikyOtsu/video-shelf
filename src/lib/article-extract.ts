import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { fetchSourceText } from "./source-fetch";
import { publicFetch } from "./public-fetch";
import { sanitizeArticleHtml } from "./reader-content";
import { articleContent } from "./article-content";
export function extractArticle(html: string, url: string) {
  const { document } = parseHTML(html);
  // No scripts execute in linkedom. Drop active and hidden/tracking content
  // before readability scoring, then sanitize the extracted result again.
  document
    .querySelectorAll(
      "script,style,iframe,object,embed,form,nav,footer,header,[hidden],[aria-hidden='true']",
    )
    .forEach((node) => node.remove());
  const article = new Readability(document as unknown as Document, {
    charThreshold: 200,
    maxElemsToParse: 25_000,
  }).parse();
  const clean = sanitizeArticleHtml(article?.content || "", url);
  if (articleContent(clean, url).text.length < 200 && !/<img\s/.test(clean))
    throw new Error("ARTICLE_UNAVAILABLE");
  return clean;
}
export async function fetchArticle(url: string) {
  const response = await fetchSourceText(
    url,
    { "user-agent": "Shelf/1.0", accept: "text/html, application/xhtml+xml" },
    10_000,
    2 * 1024 * 1024,
    publicFetch,
  );
  return extractArticle(response.text, response.url);
}
