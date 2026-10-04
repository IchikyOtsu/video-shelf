import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookieName, readSession } from "@/lib/auth";
export async function GET() { const session = await readSession((await cookies()).get(cookieName)?.value); if (!session || !db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const user = await db.query.users.findFirst({ where: eq(users.id, session.id) }); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, emailVerified: Boolean(user.emailVerifiedAt), totpEnabled: user.totpEnabled } }); }
