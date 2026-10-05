import { DigestDeliveryError, type DigestMessage } from "./daily-digest";
const appUrl = () => process.env.APP_URL?.replace(/\/$/, "");
async function send(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !appUrl()) return false;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html }) });
  return response.ok;
}
export const sendVerificationEmail = (email: string, token: string) => send(email, "Verify your Video Shelf email", `<p>Confirm your email by opening <a href="${appUrl()}/verify-email?token=${encodeURIComponent(token)}">this secure link</a>. It expires in 24 hours.</p>`);
export const sendPasswordResetEmail = (email: string, token: string) => send(email, "Reset your Video Shelf password", `<p>Reset your password with <a href="${appUrl()}/reset-password?token=${encodeURIComponent(token)}">this secure link</a>. It expires in one hour.</p>`);

// Reuses the existing verified sender; do not retain provider response bodies.
export function digestEmailConfig() {
  const url = appUrl();
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !url) throw new DigestDeliveryError("EMAIL_CONFIGURATION");
  return { appUrl: url, from: process.env.EMAIL_FROM };
}
export async function sendDigestEmail(message: DigestMessage, idempotencyKey: string): Promise<number> {
  if (!process.env.RESEND_API_KEY) throw new DigestDeliveryError("EMAIL_CONFIGURATION");
  const signal = AbortSignal.timeout(10_000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal, headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw new DigestDeliveryError(response.status === 429 ? "RATE_LIMIT" : [401, 403].includes(response.status) ? "EMAIL_CONFIGURATION" : response.status >= 500 ? "PROVIDER_ERROR" : "PROVIDER_REJECTED", response.status);
    return response.status;
  } catch (error) {
    if (error instanceof DigestDeliveryError) throw error;
    throw new DigestDeliveryError(signal.aborted ? "TIMEOUT" : "NETWORK_ERROR");
  }
}
