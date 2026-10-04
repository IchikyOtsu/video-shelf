import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createPendingTotpChallenge, createSession, cookieName, pendingTotpCookieName } from "@/lib/auth";
import { checkRateLimit, requestIdentity } from "@/lib/rate-limit";
import { db } from "@/db";
import { users } from "@/db/schema";

export async function POST(request: Request) {
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const { email, password } = await request.json();
  if (await checkRateLimit("signin", requestIdentity(request, email), 8)) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  const user = email && await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
  if (!user || !password || !(await compare(password, user.passwordHash))) return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  const publicUser = { id: user.id, name: user.name, email: user.email, sessionVersion: user.sessionVersion };
  if (user.totpEnabled) { const response = NextResponse.json({ requiresTotp: true }); response.cookies.set(pendingTotpCookieName, await createPendingTotpChallenge(publicUser), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 300 }); return response; }
  const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } }); response.cookies.set(cookieName, await createSession(publicUser), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 }); return response;
}
