import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getDashboard } from "@/lib/gateway";

export async function GET() {
  const session = requireSession();
  try {
    return NextResponse.json(await getDashboard(session));
  } catch (cause) {
    return NextResponse.json(
      { detail: cause instanceof Error ? cause.message : "No se pudo cargar el dashboard." },
      { status: 502 }
    );
  }
}
