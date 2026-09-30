import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createSession, cookieName } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";

export async function POST(request: Request) {
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const { name, email, password } = await request.json();
  if (!email || !password || password.length < 8) return NextResponse.json({ error: "Use an email and a password of at least 8 characters." }, { status: 400 });
  if (await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) })) return NextResponse.json({ error: "An account already exists for this email." }, { status: 409 });
  const [user] = await db.insert(users).values({ name: name?.trim() || null, email: email.toLowerCase(), passwordHash: await hash(password, 12) }).returning({ id: users.id, name: users.name, email: users.email });
  const response = NextResponse.json({ user });
  response.cookies.set(cookieName, await createSession(user), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}
