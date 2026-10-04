import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { guestPageDestination } from "@/lib/auth-flow";
import SignUpForm from "./signup-form";

export default async function SignUp() {
  const session = await readSession((await cookies()).get(cookieName)?.value);
  if (session && db) {
    const user = await db.query.users.findFirst({ where: eq(users.id, session.id), columns: { emailVerifiedAt: true, onboardingCompletedAt: true } });
    const destination = guestPageDestination(user ? { emailVerified: Boolean(user.emailVerifiedAt), onboardingCompleted: Boolean(user.onboardingCompletedAt) } : null);
    if (destination) redirect(destination);
  }
  return <SignUpForm />;
}
