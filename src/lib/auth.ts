import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "local-development-secret-change-me");
export const cookieName = "shelf_session";
export type Session = { id: string; email: string; name: string | null };

export async function createSession(user: Session) {
  return new SignJWT(user).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(secret);
}
export async function readSession(token?: string): Promise<Session | null> {
  if (!token) return null;
  try { return (await jwtVerify(token, secret)).payload as unknown as Session; } catch { return null; }
}
