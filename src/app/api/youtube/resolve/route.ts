import { NextResponse } from "next/server";
import { resolveYouTubeChannel } from "@/lib/youtube";
export async function GET(request: Request) { const input = new URL(request.url).searchParams.get("input"); if (!input) return NextResponse.json({ error: "Ajoute une chaîne." }, { status: 400 }); try { return NextResponse.json(await resolveYouTubeChannel(input)); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Chaîne introuvable." }, { status: 400 }); } }
