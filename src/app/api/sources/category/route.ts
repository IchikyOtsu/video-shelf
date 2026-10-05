import { cookies } from "next/headers";
import { db } from "@/db";
import { cookieName, readSession } from "@/lib/auth";
import {
  parseCategoryMove,
  moveCategoryStatement,
} from "@/lib/source-category";
export async function PATCH(request: Request) {
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user)
    return Response.json({ error: "Connexion requise." }, { status: 401 });
  if (!db)
    return Response.json({ error: "Sources indisponibles." }, { status: 503 });
  try {
    let move;
    try {
      move = parseCategoryMove(await request.json());
    } catch {
      return Response.json(
        { error: "Catégorie ou sélection invalide." },
        { status: 400 },
      );
    }
    const { ids, category } = move;
    const result = (
      await db.execute(moveCategoryStatement(user.id, ids, category))
    ).rows;
    if (result.length !== ids.length)
      return Response.json({ error: "Source introuvable." }, { status: 404 });
    return Response.json({ updated: result.length });
  } catch {
    return Response.json(
      { error: "Les catégories n’ont pas été modifiées." },
      { status: 503 },
    );
  }
}
