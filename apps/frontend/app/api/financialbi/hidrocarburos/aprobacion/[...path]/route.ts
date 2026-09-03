import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { isGerencia } from "@/lib/auth/roles";
import { aprobacionGetRequirement, aprobacionPostRequirement } from "@/lib/auth/aprobacion-policy";
import { getAprobacionCatalogCeco, getAprobacionCatalogNucleo, getAprobacionCatalogSitios, getAprobacionCompras, getAprobacionGerencia, getAprobacionHistorial } from "@/lib/gateway";
import { getFinancialbiServiceUrl } from "@/lib/env";
import type { FrontendSession } from "@/types/auth";
import type { AprobacionRequirement } from "@/lib/auth/aprobacion-policy";

type Context = { params: { path: string[] } };

function backendPath(path: string[]) {
  return `/v1/financialbi/hidrocarburos/aprobacion/${path.map(encodeURIComponent).join("/")}`;
}

async function errorResponse(cause: unknown) {
  return NextResponse.json({ detail: cause instanceof Error ? cause.message : "No se pudo actualizar la aprobación." }, { status: 502 });
}

// Autorización de servidor (LOGIN.md §3). Ocultar botones no basta: sin esto un
// usuario genérico aprueba con un curl. La política vive en aprobacion-policy.ts.
function denyIfNotAllowed(requirement: AprobacionRequirement, session: FrontendSession) {
  if (requirement === "denied") {
    return NextResponse.json({ detail: "Ruta de aprobación no encontrada." }, { status: 404 });
  }
  if (requirement === "gerencia" && !isGerencia(session)) {
    return NextResponse.json({ detail: "Esta operación requiere el rol de Gerencia." }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request, { params }: Context) {
  const session = requireSession();
  const key = params.path.join("/");

  const denied = denyIfNotAllowed(aprobacionGetRequirement(key), session);
  if (denied) return denied;

  try {
    const filtros = Object.fromEntries(new URL(request.url).searchParams);
    if (key === "compras") return NextResponse.json(await getAprobacionCompras(session, filtros));
    if (key === "gerencia") return NextResponse.json(await getAprobacionGerencia(session, filtros));
    if (key === "historial") return NextResponse.json(await getAprobacionHistorial(session, filtros));
    if (key === "catalogo/ceco") return NextResponse.json(await getAprobacionCatalogCeco(session));
    if (key === "catalogo/sitios") return NextResponse.json(await getAprobacionCatalogSitios(session));
    if (key === "catalogo/nucleo") return NextResponse.json(await getAprobacionCatalogNucleo(session));
    return NextResponse.json({ detail: "Ruta de aprobación no encontrada." }, { status: 404 });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(request: Request, { params }: Context) {
  const session = requireSession();

  const denied = denyIfNotAllowed(aprobacionPostRequirement(params.path), session);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Cuerpo JSON inválido." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ detail: "Cuerpo JSON inválido." }, { status: 400 });
  }

  // La identidad que se graba en BigQuery sale SIEMPRE de la sesión, nunca del
  // body: así una decisión no se puede firmar con el nombre de otro. Cierra la
  // deuda D27 ("identidad de texto libre").
  const payload = { ...(body as Record<string, unknown>), usuario: session.email };

  try {
    const response = await fetch(`${getFinancialbiServiceUrl()}${backendPath(params.path)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
    const responseBody = await response.text();
    if (response.status >= 500) {
      console.error("FinancialBI approval error", { path: params.path, status: response.status, body: responseBody });
      return NextResponse.json(
        { detail: "No se pudo registrar la operación. Vuelve a intentarlo en unos instantes." },
        { status: 502 }
      );
    }
    return new NextResponse(responseBody, { status: response.status, headers: { "Content-Type": "application/json" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}
