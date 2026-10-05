import { sql } from "drizzle-orm";
export function consumePasswordReset(tokenId:string, passwordHash:string) {
  return sql`with consumed as (
    update password_reset_tokens set used_at=now()
    where id=${tokenId}::uuid and used_at is null and expires_at > now()
    returning user_id
  ) update users set password_hash=${passwordHash}, session_version=session_version+1
    where id in (select user_id from consumed) returning id`;
}
