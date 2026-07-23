import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getHydrocarburosCatalog } from "@/lib/gateway";

export async function GET() {
  const session = requireSession();
  try {
    return NextResponse.json(await getHydrocarburosCatalog(session));
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "No se pudo cargar el catálogo." }, { status: 502 });
  }
}
