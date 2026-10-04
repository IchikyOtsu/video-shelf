import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
export async function POST() { const session = await readSession((await cookies()).get(cookieName)?.value); if (!session || !db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const user = await db.query.users.findFirst({ where: eq(users.id, session.id), columns: { emailVerifiedAt: true } }); if (!user?.emailVerifiedAt) return NextResponse.json({ error: "La vérification de votre e-mail est nécessaire pour continuer.", code: "EMAIL_VERIFICATION_REQUIRED" }, { status: 403 }); await db.update(users).set({ onboardingCompletedAt: new Date() }).where(eq(users.id, session.id)); return NextResponse.json({ completed: true }); }
