import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { sendPasswordResetEmail } from "@/lib/mail";
import { checkRateLimit, requestIdentity } from "@/lib/rate-limit";
import { createOpaqueToken, tokenHash } from "@/lib/security";
export async function POST(request: Request) { if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 }); const { email } = await request.json(); if (await checkRateLimit("forgot", requestIdentity(request, email), 3, 60 * 60_000)) return NextResponse.json({ error: "Too many requests. Try later." }, { status: 429 }); const user = email && await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) }); if (user) { const token = createOpaqueToken(); await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60 * 60_000) }); await sendPasswordResetEmail(user.email, token).catch(() => false); } return NextResponse.json({ ok: true }); }
