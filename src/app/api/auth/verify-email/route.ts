import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { emailVerificationTokens, users } from "@/db/schema";
import { tokenHash, tokenUsable } from "@/lib/security";
export async function POST(request: Request) { if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 }); const { token } = await request.json(); const row = token && await db.query.emailVerificationTokens.findFirst({ where: and(eq(emailVerificationTokens.tokenHash, tokenHash(token)), isNull(emailVerificationTokens.usedAt)) }); if (!row || !tokenUsable(row.expiresAt, row.usedAt)) return NextResponse.json({ error: "This verification link is invalid or expired." }, { status: 400 }); await db.transaction(async (tx) => { await tx.update(emailVerificationTokens).set({ usedAt: new Date() }).where(eq(emailVerificationTokens.id, row.id)); await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId)); }); return NextResponse.json({ verified: true }); }
