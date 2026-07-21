import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getFinancialbiCatalog } from "@/lib/gateway";

export async function GET() {
  const session = requireSession();
  try {
    const payload = await getFinancialbiCatalog(session);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error
            ? error.message
            : "No se pudo cargar el catalogo de FinancialBI."
      },
      { status: 502 }
    );
  }
}
