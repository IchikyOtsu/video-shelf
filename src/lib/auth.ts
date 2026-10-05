import { sessionPurpose } from "./request-security";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export const cookieName = "shelf_session";
export type Session = { id: string; email: string; name: string | null; sessionVersion?: number };

export function resolveAuthSecret(value = process.env.AUTH_SECRET, environment = process.env.NODE_ENV) {
  if (value) return new TextEncoder().encode(value);
  if (environment === "production") throw new Error("AUTH_SECRET is required in production.");
  return new TextEncoder().encode("local-development-secret-change-me");
}

export async function createSession(user: Session) {
  return new SignJWT({ ...user, purpose:"session" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(resolveAuthSecret());
}
export async function readSession(token?: string): Promise<Session | null> {
  if (!token) return null;
  const secret = resolveAuthSecret();
  try {
    const session = (await jwtVerify(token, secret)).payload as unknown as Session;
    if (!sessionPurpose(session as Session & { purpose?:unknown }) || !session.id || !db) return null;
    const user = await db.query.users.findFirst({ where: eq(users.id, session.id), columns: { sessionVersion: true } });
    if (!user || (session.sessionVersion ?? 0) !== user.sessionVersion) return null;
    return session;
  } catch { return null; }
}
export const pendingTotpCookieName = "shelf_pending_totp";
export async function createPendingTotpChallenge(user: Session) { return new SignJWT({ ...user, purpose: "pending_totp" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(resolveAuthSecret()); }
export async function readPendingTotpChallenge(token?: string): Promise<Session | null> { try { const payload = (await jwtVerify(token || "", resolveAuthSecret())).payload as unknown as Session & { purpose?: string }; return payload.purpose === "pending_totp" ? payload : null; } catch { return null; } }
export function setSessionCookie(response: { cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void } }, user: Session) { return createSession(user).then((token) => { response.cookies.set(cookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 }); return response; }); }
