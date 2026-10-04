const appUrl = () => process.env.APP_URL?.replace(/\/$/, "");
async function send(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !appUrl()) return false;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html }) });
  return response.ok;
}
export const sendVerificationEmail = (email: string, token: string) => send(email, "Verify your Video Shelf email", `<p>Confirm your email by opening <a href="${appUrl()}/verify-email?token=${encodeURIComponent(token)}">this secure link</a>. It expires in 24 hours.</p>`);
export const sendPasswordResetEmail = (email: string, token: string) => send(email, "Reset your Video Shelf password", `<p>Reset your password with <a href="${appUrl()}/reset-password?token=${encodeURIComponent(token)}">this secure link</a>. It expires in one hour.</p>`);
