import { checkRateLimit } from "@/lib/rate-limit";
import { compare } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { encryptTotp, generateTotpSecret, otpAuthUrl } from "@/lib/security";
export async function POST(request: Request) { const session = await readSession((await cookies()).get(cookieName)?.value); if (!session || !db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); if (await checkRateLimit("account-totp",session.id,10,15 * 60_000)) return NextResponse.json({ error:"Trop de tentatives. Réessaie plus tard." },{ status:429 }); const { currentPassword } = await request.json(); const user = await db.query.users.findFirst({ where: eq(users.id, session.id) }); if (!user || !(await compare(currentPassword || "", user.passwordHash))) return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 }); if (user.totpEnabled) return NextResponse.json({ error:"Désactive d’abord le double facteur avec un code valide." },{ status:409 }); const secret = generateTotpSecret(); const updated = await db.update(users).set({ totpSecretEncrypted: encryptTotp(secret), totpEnabled: false }).where(and(eq(users.id, user.id),eq(users.totpEnabled,false))).returning({ id:users.id }); if (!updated.length) return NextResponse.json({ error:"Le double facteur a changé." },{ status:409 }); return NextResponse.json({ secret, otpauthUrl: otpAuthUrl(user.email, secret) }); }
