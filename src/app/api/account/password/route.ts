import { checkRateLimit } from "@/lib/rate-limit";
import { compare, hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
export async function POST(request: Request) { const session = await readSession((await cookies()).get(cookieName)?.value); if (!session || !db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); if (await checkRateLimit("account-password",session.id,5)) return NextResponse.json({ error:"Trop de tentatives. Réessaie plus tard." },{ status:429 }); const { currentPassword, password } = await request.json(); const user = await db.query.users.findFirst({ where: eq(users.id, session.id) }); if (!user || !(await compare(currentPassword || "", user.passwordHash))) return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 }); if (!password || password.length < 8) return NextResponse.json({ error: "Use a password of at least 8 characters." }, { status: 400 }); await db.update(users).set({ passwordHash: await hash(password, 12), sessionVersion: user.sessionVersion + 1 }).where(eq(users.id, user.id)); return NextResponse.json({ changed: true }); }
