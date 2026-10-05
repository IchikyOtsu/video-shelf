export type ExportSource = {
  name: string;
  feedUrl: string;
  siteUrl: string | null;
  category: string;
  kind: string;
};
const xml = (value: string) =>
  value
    .replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[char]!,
    )
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
export function exportOpml(sources: ExportSource[]) {
  const groups = new Map<string, ExportSource[]>();
  for (const source of sources) {
    const key = source.category || "Non classé";
    groups.set(key, [...(groups.get(key) || []), source]);
  }
  const outlines = [...groups]
    .map(
      ([category, entries]) =>
        `<outline text="${xml(category)}">${entries.map((source) => `<outline type="rss" text="${xml(source.name)}" title="${xml(source.name)}" xmlUrl="${xml(source.feedUrl)}"${source.siteUrl ? ` htmlUrl="${xml(source.siteUrl)}"` : ""}/>`).join("")}</outline>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>Shelf — Sources</title></head><body>${outlines}</body></opml>`;
}
export function csvCell(value: unknown) {
  let text =
    value == null
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  if (/^\s*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function exportCsv(rows: Record<string, unknown>[]) {
  const fields = [
    "title",
    "url",
    "sourceName",
    "category",
    "mediaType",
    "author",
    "publishedAt",
    "read",
    "progressSeconds",
    "durationSeconds",
  ];
  return (
    "\uFEFF" +
    [
      fields.map(csvCell).join(","),
      ...rows.map((row) =>
        fields.map((field) => csvCell(row[field])).join(","),
      ),
    ].join("\r\n")
  );
}
