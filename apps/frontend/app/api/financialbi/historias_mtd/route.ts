import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getFinancialbiHistoriasMtd } from "@/lib/gateway";

export async function GET() {
  const session = requireSession();
  try {
    const payload = await getFinancialbiHistoriasMtd(session);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error
            ? error.message
            : "No se pudieron cargar las historias de ritmo (mes a la fecha)."
      },
      { status: 502 }
    );
  }
}
