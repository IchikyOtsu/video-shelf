import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieName, readSession } from "@/lib/auth";
export async function GET() { const user = await readSession((await cookies()).get(cookieName)?.value); return NextResponse.json({ user }); }
