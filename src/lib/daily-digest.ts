export type DigestItem = { id: string; sourceId: string; sourceName: string; title: string; url: string; mediaType: string; publishedAt: string | null };
export type Digest = { runId: string; userId: string; recipient: string; itemCount: number; payload: DigestItem[]; message: DigestMessage | null; firstAttemptAt: string | Date | null };
export type DigestMessage = { from: string; to: string; subject: string; html: string; text: string };
export const DIGEST_ITEM_LIMIT = 20;
export const DIGEST_RETRY_WINDOW_MS = 23 * 60 * 60_000;
export const dailyCronRunId = (now = new Date()) => `daily-${now.toISOString().slice(0, 10)}`;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function safeLink(input: string) { try { const url = new URL(input); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : null; } catch { return null; } }
export function renderDigest(digest: Pick<Digest, "recipient" | "itemCount" | "payload">, appUrl: string, from: string): DigestMessage {
  const base = safeLink(appUrl);
  if (!base) throw new DigestDeliveryError("EMAIL_CONFIGURATION");
  const inbox = new URL("/?view=inbox", base).toString();
  const settings = new URL("/", base).toString();
  const groups = new Map<string, { name: string; items: DigestItem[] }>();
  for (const item of digest.payload.slice(0, DIGEST_ITEM_LIMIT)) {
    const group = groups.get(item.sourceId) || { name: item.sourceName, items: [] };
    group.items.push(item); groups.set(item.sourceId, group);
  }
  const subject = `Shelf — ${digest.itemCount} nouveauté${digest.itemCount > 1 ? "s" : ""}`;
  const heading = `${digest.itemCount} nouveau${digest.itemCount > 1 ? "x" : ""} contenu${digest.itemCount > 1 ? "s" : ""}`;
  const lines = [heading, ""];
  let sections = "";
  for (const group of groups.values()) {
    lines.push(group.name);
    sections += `<h2 style="font-size:17px;margin:24px 0 12px;color:#35452b">${escape(group.name)}</h2>`;
    for (const item of group.items) {
      const type = item.mediaType === "video" ? "Vidéo" : item.mediaType === "podcast" ? "Podcast" : "Article";
      const parsed = item.publishedAt ? new Date(item.publishedAt) : null;
      const date = parsed && !Number.isNaN(parsed.getTime()) ? new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium", timeZone: "UTC" }).format(parsed) : "";
      const metadata = type + (date ? ` · ${date}` : "");
      const link = safeLink(item.url);
      sections += `<p style="margin:0 0 16px;line-height:1.5">${link ? `<a href="${escape(link)}" style="color:#35452b;text-decoration:underline">${escape(item.title)}</a>` : escape(item.title)}<br><span style="font-size:12px;color:#6c7168">${escape(metadata)}</span></p>`;
      lines.push(`- ${item.title} (${metadata})${link ? `\n  ${link}` : ""}`);
    }
    lines.push("");
  }
  const more = digest.itemCount > DIGEST_ITEM_LIMIT ? `<p style="font-size:13px;color:#6c7168">Les ${DIGEST_ITEM_LIMIT} premiers contenus sont affichés ici.</p>` : "";
  lines.push(`Voir toutes les nouveautés : ${inbox}`, "", `Désactiver le digest dans les réglages du compte : ${settings}`);
  return { from, to: digest.recipient, subject, text: lines.join("\n"), html: `<!doctype html><html lang="fr"><body style="margin:0;background:#f5f4ed;font-family:Arial,sans-serif;color:#30372b"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff"><tr><td style="padding:28px"><p style="margin:0 0 12px;font-size:13px;color:#6c7168">SHELF · VOS NOUVEAUTÉS DU JOUR</p><h1 style="font-size:24px;margin:0 0 12px">${heading}</h1><p style="font-size:14px;line-height:1.5">Les nouveaux contenus récupérés pendant l’actualisation quotidienne.</p>${sections}${more}<p style="margin:24px 0"><a href="${escape(inbox)}" style="color:#35452b;font-weight:bold">Voir toutes les nouveautés</a></p><p style="font-size:12px;line-height:1.5;color:#6c7168">Vous pouvez désactiver cet email dans les <a href="${escape(settings)}" style="color:#6c7168">réglages de votre compte Shelf</a>.</p></td></tr></table></td></tr></table></body></html>` };
}

export type DigestErrorCategory = "EMAIL_CONFIGURATION" | "RATE_LIMIT" | "PROVIDER_ERROR" | "PROVIDER_REJECTED" | "TIMEOUT" | "NETWORK_ERROR" | "DELIVERY_ERROR" | "IDEMPOTENCY_EXPIRED";
const safeCategories = new Set<DigestErrorCategory>(["EMAIL_CONFIGURATION", "RATE_LIMIT", "PROVIDER_ERROR", "PROVIDER_REJECTED", "TIMEOUT", "NETWORK_ERROR", "DELIVERY_ERROR", "IDEMPOTENCY_EXPIRED"]);
export class DigestDeliveryError extends Error {
  readonly category: DigestErrorCategory;
  readonly status?: number;
  constructor(category: DigestErrorCategory, status?: number) {
    super("Digest delivery failed");
    this.category = safeCategories.has(category) ? category : "DELIVERY_ERROR";
    this.status = Number.isInteger(status) && status! >= 100 && status! <= 599 ? status : undefined;
  }
}
export type DigestDeliveryStore = {
  pendingDigests(runId: string): Promise<Digest[]>;
  claimDigest(digest: Digest, token: string, message: DigestMessage): Promise<Digest | null>;
  finishDigest(digest: Digest, token: string, status: "sent" | "failed" | "abandoned", providerStatus: number | null, category: string | null): Promise<void>;
};
export async function deliverDigests(runId: string, store: DigestDeliveryStore, deps: {
  send(message: DigestMessage, key: string): Promise<number>; config(): { appUrl: string; from: string };
  token(): string; deadlineMs: number; now?: () => number; wait?: (ms: number) => Promise<void>;
}) {
  const now = deps.now || Date.now;
  const wait = deps.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const summary = { emailsSent: 0, emailsFailed: 0, emailsDeferred: 0 };
  const rows = await store.pendingDigests(runId);
  let nextSendAt = 0;
  for (let index = 0; index < rows.length; index++) {
    const digest = rows[index];
    if (now() + 15_000 >= deps.deadlineMs) { summary.emailsDeferred += rows.length - index; break; }
    const token = deps.token();
    let claimed = false;
    try {
      if (digest.firstAttemptAt && now() - new Date(digest.firstAttemptAt).getTime() >= DIGEST_RETRY_WINDOW_MS) {
        await store.finishDigest(digest, "", "abandoned", null, "IDEMPOTENCY_EXPIRED");
        throw new DigestDeliveryError("IDEMPOTENCY_EXPIRED");
      }
      const config = digest.message ? null : deps.config();
      const message = digest.message || renderDigest(digest, config!.appUrl, config!.from);
      const current = await store.claimDigest(digest, token, message);
      if (!current) continue; // Already sent, disabled, or another delivery owns it.
      claimed = true;
      const delay = Math.max(0, nextSendAt - now());
      if (delay) await wait(delay);
      nextSendAt = now() + 550; // Resend's default rate limit is two requests/second.
      const status = await deps.send(current.message!, `shelf-digest-${runId}-${digest.userId}`);
      await store.finishDigest(digest, token, "sent", status, null);
      summary.emailsSent++;
      console.info("Digest delivery", { userId: digest.userId, itemCount: digest.itemCount, success: true, status, error: null });
    } catch (error) {
      const safe = error instanceof DigestDeliveryError ? error : new DigestDeliveryError("DELIVERY_ERROR");
      if (claimed) {
        try { await store.finishDigest(digest, token, "failed", safe.status ?? null, safe.category); } catch { /* Persistent idempotency data survives acknowledgement failure. */ }
      }
      summary.emailsFailed++;
      console.error("Digest delivery", { userId: digest.userId, itemCount: digest.itemCount, success: false, status: safe.status ?? null, error: safe.category });
    }
  }
  return summary;
}
