import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { searchHydrocarburosInvoices } from "@/lib/gateway";
import type { HydrocarburosSearchRequest } from "@/types/hidrocarburos";

export async function POST(request: Request) {
  const session = requireSession();
  try {
    return NextResponse.json(await searchHydrocarburosInvoices(session, (await request.json()) as HydrocarburosSearchRequest));
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "No se pudo cargar la bandeja." }, { status: 502 });
  }
}
