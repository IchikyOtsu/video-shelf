import { checkRateLimit } from "@/lib/rate-limit";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieName, readSession } from "@/lib/auth";
import { searchYouTubeChannels } from "@/lib/youtube";

export async function GET(request: Request) {
  const user = await readSession((await cookies()).get(cookieName)?.value);
  if (!user) return NextResponse.json({ error: "Connecte-toi pour rechercher des chaînes." }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (query.length < 2 || query.length > 200) return NextResponse.json({ error: "Saisis entre 2 et 200 caractères." }, { status: 400 });
  if (await checkRateLimit("youtube-search", user.id, 20, 60 * 60_000)) return NextResponse.json({ error:"Trop de recherches. Utilise le lien direct de la chaîne ou réessaie plus tard." }, { status:429 });
  try {
    return NextResponse.json({ channels: await searchYouTubeChannels(query) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.name !== "TimeoutError" ? error.message : "YouTube met trop de temps à répondre. Réessaie." }, { status: 502 });
  }
}
