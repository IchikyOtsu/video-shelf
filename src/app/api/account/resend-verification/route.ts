import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { emailVerificationTokens, users } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/mail";
import { checkRateLimit } from "@/lib/rate-limit";
import { createOpaqueToken, tokenHash } from "@/lib/security";
export async function POST() { const session = await readSession((await cookies()).get(cookieName)?.value); if (!session || !db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); if (await checkRateLimit("resend-verification", session.id, 3, 60 * 60_000)) return NextResponse.json({ error: "Too many requests. Try later." }, { status: 429 }); const user = await db.query.users.findFirst({ where: eq(users.id, session.id) }); if (!user || user.emailVerifiedAt) return NextResponse.json({ ok: true }); const token = createOpaqueToken(); await db.insert(emailVerificationTokens).values({ userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }); const sent = await sendVerificationEmail(user.email, token).catch(() => false); return NextResponse.json({ ok: true, sent }); }
