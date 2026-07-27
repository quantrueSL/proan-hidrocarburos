import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getDashboard } from "@/lib/gateway";

export async function GET(request: Request) {
  const session = requireSession();
  try {
    const filtros = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json(await getDashboard(session, filtros));
  } catch (cause) {
    return NextResponse.json(
      { detail: cause instanceof Error ? cause.message : "No se pudo cargar el dashboard." },
      { status: 502 }
    );
  }
}
