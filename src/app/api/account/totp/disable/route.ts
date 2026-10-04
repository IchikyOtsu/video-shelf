import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { recoveryCodes, users } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { decryptTotp, verifyTotp } from "@/lib/security";
export async function POST(request: Request) { const session = await readSession((await cookies()).get(cookieName)?.value); if (!session || !db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const { currentPassword, code } = await request.json(); const user = await db.query.users.findFirst({ where: eq(users.id, session.id) }); if (!user || !(await compare(currentPassword || "", user.passwordHash)) || !user.totpSecretEncrypted || !verifyTotp(decryptTotp(user.totpSecretEncrypted), String(code || ""))) return NextResponse.json({ error: "Step-up verification failed." }, { status: 400 }); await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id)); await db.update(users).set({ totpEnabled: false, totpSecretEncrypted: null, sessionVersion: user.sessionVersion + 1 }).where(eq(users.id, user.id)); return NextResponse.json({ disabled: true }); }
