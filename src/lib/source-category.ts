import { sql } from "drizzle-orm";
import { uuidPattern } from "./library";
export function parseCategoryMove(body: unknown) {
  const value =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (
    !Array.isArray(value.ids) ||
    !value.ids.length ||
    value.ids.length > 100 ||
    value.ids.some((id) => typeof id !== "string" || !uuidPattern.test(id)) ||
    typeof value.category !== "string" ||
    !value.category.trim() ||
    value.category.length > 80
  )
    throw new Error("Catégorie ou sélection invalide.");
  return {
    ids: [...new Set(value.ids)] as string[],
    category: value.category.trim(),
  };
}
export function moveCategoryStatement(
  userId: string,
  ids: string[],
  category: string,
) {
  const selected = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  // Refuse the whole operation if one selected source belongs to another user.
  return sql`update sources set category=${category} where user_id=${userId}::uuid and id in (${selected})
    and (select count(*) from sources owned where owned.user_id=${userId}::uuid and owned.id in (${selected})) = ${ids.length} returning id`;
}
