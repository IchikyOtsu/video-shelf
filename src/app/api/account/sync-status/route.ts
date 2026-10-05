import { cookies } from "next/headers";
import { db } from "@/db";
import { cookieName, readSession } from "@/lib/auth";
import { automaticSyncStatus } from "@/lib/sync-status";
export async function GET() {
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user)
    return Response.json({ error: "Connexion requise." }, { status: 401 });
  if (!db)
    return Response.json({ error: "Statut indisponible." }, { status: 503 });
  const database = db;
  try {
    return Response.json(
      {
        run: await automaticSyncStatus(
          async (statement) =>
            (await database.execute(statement)).rows as never[],
          user.id,
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json({ error: "Statut indisponible." }, { status: 503 });
  }
}
