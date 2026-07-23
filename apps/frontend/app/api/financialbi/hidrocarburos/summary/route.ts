import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getHydrocarburosSummary } from "@/lib/gateway";
import type { HydrocarburosFilters } from "@/types/hidrocarburos";

export async function POST(request: Request) {
  const session = requireSession();
  try {
    return NextResponse.json(await getHydrocarburosSummary(session, (await request.json()) as HydrocarburosFilters));
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "No se pudo cargar el resumen." }, { status: 502 });
  }
}
