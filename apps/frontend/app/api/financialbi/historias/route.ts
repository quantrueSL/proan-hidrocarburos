import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getFinancialbiHistorias } from "@/lib/gateway";
import type { FinancialbiRequest } from "@/types/financialbi";

export async function POST(request: Request) {
  const session = requireSession();
  try {
    const body = (await request.json()) as FinancialbiRequest;
    const payload = await getFinancialbiHistorias(session, body);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error
            ? error.message
            : "No se pudieron cargar las historias de alertas."
      },
      { status: 502 }
    );
  }
}
