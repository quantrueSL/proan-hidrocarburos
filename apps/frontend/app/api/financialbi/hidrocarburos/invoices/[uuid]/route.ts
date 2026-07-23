import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getHydrocarburosInvoice } from "@/lib/gateway";

export async function GET(_request: Request, { params }: { params: { uuid: string } }) {
  const session = requireSession();
  try {
    return NextResponse.json(await getHydrocarburosInvoice(session, params.uuid));
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "No se pudo cargar la factura." }, { status: 502 });
  }
}
