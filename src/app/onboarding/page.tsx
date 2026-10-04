import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { Onboarding } from "./onboarding";
export default async function OnboardingPage() { const session = await readSession((await cookies()).get(cookieName)?.value); if (!session || !db) redirect("/signin"); const user = await db.query.users.findFirst({ where: eq(users.id, session.id), columns: { onboardingCompletedAt: true } }); if (!user || user.onboardingCompletedAt) redirect("/"); return <Onboarding />; }
