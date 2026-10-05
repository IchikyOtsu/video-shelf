import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

const openApi = new Set(["/api/auth/me", "/api/auth/signout", "/api/auth/verify-email", "/api/account", "/api/account/resend-verification"]);
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/api/cron/sync" || path.startsWith("/_next") || path.startsWith("/signin") || path.startsWith("/signup") || path.startsWith("/verify-email") || path.startsWith("/api/auth/")) return NextResponse.next();
  const session = await readSession(request.cookies.get("shelf_session")?.value);
  if (!session || !db) return path.startsWith("/api/") ? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) : NextResponse.redirect(new URL("/signin", request.url));
  const user = await db.query.users.findFirst({ where: eq(users.id, session.id), columns: { emailVerifiedAt: true, onboardingCompletedAt: true } });
  if (!user) return NextResponse.redirect(new URL("/signin", request.url));
  if (!user.emailVerifiedAt) {
    if (openApi.has(path)) return NextResponse.next();
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Email verification required.", code: "EMAIL_VERIFICATION_REQUIRED" }, { status: 403 });
    if (path !== "/onboarding") return NextResponse.redirect(new URL("/onboarding", request.url));
  }
  if (path === "/onboarding" && user.onboardingCompletedAt) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}
export const config = { matcher: ["/((?!favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
