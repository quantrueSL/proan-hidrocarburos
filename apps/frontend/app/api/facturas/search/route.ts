import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { searchFacturas } from "@/lib/facturas-api";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  requireSession();
  const params = new URL(request.url).searchParams;
  const uuid = params.get("uuid")?.trim();
  if (uuid && !UUID_PATTERN.test(uuid)) {
    return NextResponse.json({ detail: "El UUID no tiene un formato válido." }, { status: 400 });
  }
  try {
    return NextResponse.json(await searchFacturas({
      uuid: uuid || undefined,
      fecha_desde: params.get("fecha_desde") || undefined,
      fecha_hasta: params.get("fecha_hasta") || undefined,
      rfc_emisor: params.getAll("rfc_emisor").filter(Boolean),
      nucleo: params.getAll("nucleo").filter(Boolean),
      limit: Number(params.get("limit") || "100"),
      offset: Number(params.get("offset") || "0")
    }));
  } catch (cause) {
    return NextResponse.json({ detail: cause instanceof Error ? cause.message : "No se pudieron buscar las facturas." }, { status: 502 });
  }
}
