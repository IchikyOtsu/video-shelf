import { checkRateLimit } from "@/lib/rate-limit";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { recoveryCodes, users } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { decryptTotp, hashRecoveryCode, recoveryCode, verifyTotp } from "@/lib/security";
export async function POST(request: Request) { const session = await readSession((await cookies()).get(cookieName)?.value); if (!session || !db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); if (await checkRateLimit("account-totp",session.id,10,15 * 60_000)) return NextResponse.json({ error:"Trop de tentatives. Réessaie plus tard." },{ status:429 }); const { code } = await request.json(); const user = await db.query.users.findFirst({ where: eq(users.id, session.id) }); if (!user?.totpSecretEncrypted || !verifyTotp(decryptTotp(user.totpSecretEncrypted), String(code || ""))) return NextResponse.json({ error: "Invalid authentication code." }, { status: 400 }); const codes = Array.from({ length: 8 }, recoveryCode); await db.insert(recoveryCodes).values(codes.map((code) => ({ userId: user.id, codeHash: hashRecoveryCode(code) }))); await db.update(users).set({ totpEnabled: true }).where(eq(users.id, user.id)); return NextResponse.json({ enabled: true, recoveryCodes: codes }); }
