import { checkRateLimit } from "@/lib/rate-limit";
import { compare } from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { recoveryCodes, users } from "@/db/schema";
import { cookieName, readSession } from "@/lib/auth";
import { decryptTotp, hashRecoveryCode, verifyTotp } from "@/lib/security";

export async function POST(request: Request) {
  const session = await readSession((await cookies()).get(cookieName)?.value);
  if (!session || !db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); if (await checkRateLimit("account-totp",session.id,10,15 * 60_000)) return NextResponse.json({ error:"Trop de tentatives. Réessaie plus tard." },{ status:429 });
  const { currentPassword, code } = await request.json();
  const user = await db.query.users.findFirst({ where: eq(users.id, session.id) });
  const value = String(code || "");
  if (!user || !user.totpEnabled || !(await compare(currentPassword || "", user.passwordHash))) return NextResponse.json({ error: "Step-up verification failed." }, { status: 400 });

  const totpValid = Boolean(user.totpSecretEncrypted && verifyTotp(decryptTotp(user.totpSecretEncrypted), value));
  if (totpValid) {
    await db.batch([
      db.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id)),
      db.update(users).set({ totpEnabled: false, totpSecretEncrypted: null, sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, user.id)),
    ]);
    return NextResponse.json({ disabled: true });
  }

  // The conditional update consumes the recovery code and disables TOTP in one SQL statement.
  const result = await db.execute(sql`
    WITH consumed AS (
      UPDATE ${recoveryCodes}
      SET ${recoveryCodes.usedAt} = now()
      WHERE ${recoveryCodes.userId} = ${user.id}
        AND ${recoveryCodes.codeHash} = ${hashRecoveryCode(value)}
        AND ${recoveryCodes.usedAt} IS NULL
      RETURNING ${recoveryCodes.id}
    )
    UPDATE ${users}
    SET ${users.totpEnabled} = false,
        ${users.totpSecretEncrypted} = null,
        ${users.sessionVersion} = ${users.sessionVersion} + 1
    WHERE ${users.id} = ${user.id} AND EXISTS (SELECT 1 FROM consumed)
    RETURNING ${users.id}
  `);
  if (!result.rows.length) return NextResponse.json({ error: "Un code d’authentification ou de récupération valide est requis." }, { status: 400 });
  await db.delete(recoveryCodes).where(and(eq(recoveryCodes.userId, user.id), isNull(recoveryCodes.usedAt)));
  return NextResponse.json({ disabled: true });
}
