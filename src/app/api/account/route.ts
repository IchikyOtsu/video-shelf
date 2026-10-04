import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { cookieName, readSession } from "@/lib/auth";
export async function GET() { const session = await readSession((await cookies()).get(cookieName)?.value); if (!session || !db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); return NextResponse.json({ user: { id: session.id, email: session.email, name: session.name } }); }
