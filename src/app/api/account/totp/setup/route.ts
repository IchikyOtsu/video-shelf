import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { encryptTotp, generateTotpSecret, otpAuthUrl } from "@/lib/security";
export async function POST(request: Request) { const session = await readSession((await cookies()).get(cookieName)?.value); if (!session || !db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const { currentPassword } = await request.json(); const user = await db.query.users.findFirst({ where: eq(users.id, session.id) }); if (!user || !(await compare(currentPassword || "", user.passwordHash))) return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 }); const secret = generateTotpSecret(); await db.update(users).set({ totpSecretEncrypted: encryptTotp(secret), totpEnabled: false }).where(eq(users.id, user.id)); return NextResponse.json({ secret, otpauthUrl: otpAuthUrl(user.email, secret) }); }
