import { checkRateLimit, requestIdentity } from "@/lib/rate-limit";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createSession, cookieName } from "@/lib/auth";
import { createOpaqueToken, tokenHash } from "@/lib/security";
import { sendVerificationEmail } from "@/lib/mail";
import { db } from "@/db";
import { emailVerificationTokens, users } from "@/db/schema";

export async function POST(request: Request) {
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  if (await checkRateLimit("signup",requestIdentity(request),5,60 * 60_000)) return NextResponse.json({ error:"Trop de créations de compte. Réessaie plus tard." },{ status:429 });
  const { name, email, password } = await request.json();
  if (typeof email !== "string" || email.length > 320 || !email.includes("@") || typeof password !== "string" || password.length < 8 || password.length > 1024 || name !== undefined && (typeof name !== "string" || name.length > 200)) return NextResponse.json({ error: "Use an email and a password of at least 8 characters." }, { status: 400 });
  if (await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) })) return NextResponse.json({ error: "An account already exists for this email." }, { status: 409 });
  const [user] = await db.insert(users).values({ name: name?.trim() || null, email: email.toLowerCase(), passwordHash: await hash(password, 12) }).returning({ id: users.id, name: users.name, email: users.email, sessionVersion: users.sessionVersion });
  const token = createOpaqueToken(); await db.insert(emailVerificationTokens).values({ userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 24 * 60 * 60_000) });
  const verificationEmailSent = await sendVerificationEmail(user.email, token).catch(() => false);
  const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email }, verificationEmailSent, onboardingRequired: true }); response.cookies.set(cookieName, await createSession(user), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 }); return response;
}
