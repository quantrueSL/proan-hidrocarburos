import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getAprobacionCatalogCeco, getAprobacionCatalogSitios, getAprobacionCompras, getAprobacionGerencia, getAprobacionHistorial } from "@/lib/gateway";
import { getFinancialbiServiceUrl } from "@/lib/env";

type Context = { params: { path: string[] } };

function backendPath(path: string[]) {
  return `/v1/financialbi/hidrocarburos/aprobacion/${path.map(encodeURIComponent).join("/")}`;
}

async function errorResponse(cause: unknown) {
  return NextResponse.json({ detail: cause instanceof Error ? cause.message : "No se pudo actualizar la aprobación." }, { status: 502 });
}

export async function GET(request: Request, { params }: Context) {
  const session = requireSession();
  try {
    const key = params.path.join("/");
    const filtros = Object.fromEntries(new URL(request.url).searchParams);
    if (key === "compras") return NextResponse.json(await getAprobacionCompras(session, filtros));
    if (key === "gerencia") return NextResponse.json(await getAprobacionGerencia(session, filtros));
    if (key === "historial") return NextResponse.json(await getAprobacionHistorial(session, filtros));
    if (key === "catalogo/ceco") return NextResponse.json(await getAprobacionCatalogCeco(session));
    if (key === "catalogo/sitios") return NextResponse.json(await getAprobacionCatalogSitios(session));
    return NextResponse.json({ detail: "Ruta de aprobación no encontrada." }, { status: 404 });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(request: Request, { params }: Context) {
  requireSession();
  try {
    const response = await fetch(`${getFinancialbiServiceUrl()}${backendPath(params.path)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await request.json()),
      cache: "no-store"
    });
    const body = await response.text();
    if (response.status >= 500) {
      console.error("FinancialBI approval error", { path: params.path, status: response.status, body });
      return NextResponse.json(
        { detail: "No se pudo registrar la operación. Vuelve a intentarlo en unos instantes." },
        { status: 502 }
      );
    }
    return new NextResponse(body, { status: response.status, headers: { "Content-Type": "application/json" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}
