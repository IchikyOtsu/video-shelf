import { and, eq, isNull, sql } from "drizzle-orm";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { checkRateLimit, requestIdentity } from "@/lib/rate-limit";
import { tokenHash, tokenUsable } from "@/lib/security";
export async function POST(request: Request) { if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 }); const { token, password } = await request.json(); if (!password || password.length < 8) return NextResponse.json({ error: "Use a password of at least 8 characters." }, { status: 400 }); if (await checkRateLimit("reset", requestIdentity(request), 5)) return NextResponse.json({ error: "Too many attempts. Try later." }, { status: 429 }); const row = token && await db.query.passwordResetTokens.findFirst({ where: and(eq(passwordResetTokens.tokenHash, tokenHash(token)), isNull(passwordResetTokens.usedAt)) }); if (!row || !tokenUsable(row.expiresAt, row.usedAt)) return NextResponse.json({ error: "This reset link is invalid or expired." }, { status: 400 }); await db.update(users).set({ passwordHash: await hash(password, 12), sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, row.userId)); await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id)); return NextResponse.json({ reset: true }); }
