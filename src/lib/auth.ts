import { SignJWT, jwtVerify } from "jose";

export const cookieName = "shelf_session";
export type Session = { id: string; email: string; name: string | null };

export function resolveAuthSecret(value = process.env.AUTH_SECRET, environment = process.env.NODE_ENV) {
  if (value) return new TextEncoder().encode(value);
  if (environment === "production") throw new Error("AUTH_SECRET is required in production.");
  return new TextEncoder().encode("local-development-secret-change-me");
}

export async function createSession(user: Session) {
  return new SignJWT(user).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(resolveAuthSecret());
}
export async function readSession(token?: string): Promise<Session | null> {
  if (!token) return null;
  const secret = resolveAuthSecret();
  try { return (await jwtVerify(token, secret)).payload as unknown as Session; } catch { return null; }
}
