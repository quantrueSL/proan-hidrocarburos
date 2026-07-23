import { getFinancialbiServiceUrl } from "@/lib/env";
import type { FrontendSession } from "@/types/auth";
import type { UserRead } from "@/types/gateway";
import type {
  HydrocarburosCatalog,
  HydrocarburosFilters,
  HydrocarburosInvoiceDetail,
  HydrocarburosSearchRequest,
  HydrocarburosSearchResponse,
  HydrocarburosSummary
} from "@/types/hidrocarburos";
import type { AprobacionCatalog, AprobacionQueue } from "@/types/aprobacion";

type FinancialbiFetchOptions = {
  method?: "GET" | "POST";
  body?: unknown;
};

async function financialbiFetchJson<T>(
  path: string,
  options: FinancialbiFetchOptions = {}
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${getFinancialbiServiceUrl()}${path}`, {
      method: options.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    });
  } catch {
    throw new Error(`FinancialBI request failed for ${path}.`);
  }

  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const detail =
      payload &&
      typeof payload === "object" &&
      "detail" in payload &&
      typeof payload.detail === "string"
        ? payload.detail
        : `FinancialBI request failed with status ${response.status}.`;

    throw new Error(detail);
  }

  return payload as T;
}

// ─────────────────────────────────────────────────────────────────────────
// Usuario / sesión
//
// No hay servicio de usuarios propio todavía (se quitó apps/auth + el
// almacén de usuarios de apps/gateway). El usuario se sintetiza a partir
// del JWT/sesión de login. Sustituir por persistencia real cuando se
// decida el mecanismo de login definitivo de este repo.
// ─────────────────────────────────────────────────────────────────────────

export async function ensureGatewayUser(input: {
  token: string;
  email: string;
  displayName?: string | null;
}): Promise<UserRead> {
  return {
    user_id: input.email,
    email: input.email,
    display_name: input.displayName ?? input.email,
    role: "user",
    user_instructions: null,
    created_at: new Date(0).toISOString()
  };
}

export async function getCurrentUser(session: FrontendSession): Promise<UserRead> {
  return {
    user_id: session.gatewayUserId,
    email: session.email,
    display_name: session.displayName,
    role: "user",
    user_instructions: null,
    created_at: new Date(0).toISOString()
  };
}

export async function updateCurrentUserInstructions(
  session: FrontendSession,
  userInstructions: string | null
): Promise<UserRead> {
  // Placeholder sin persistencia: la sección "Instrucciones del agente" del
  // perfil está desactivada en client.config.ts (features.profile.instructions).
  return {
    user_id: session.gatewayUserId,
    email: session.email,
    display_name: session.displayName,
    role: "user",
    user_instructions: userInstructions,
    created_at: new Date(0).toISOString()
  };
}

// ─────────────────────────────────────────────────────────────────────────
// FinancialBI (reportes + alertas)
// ─────────────────────────────────────────────────────────────────────────

export async function getHydrocarburosCatalog(_session: FrontendSession): Promise<HydrocarburosCatalog> {
  return financialbiFetchJson<HydrocarburosCatalog>("/v1/financialbi/hidrocarburos/catalog");
}

export async function getHydrocarburosSummary(
  _session: FrontendSession, input: HydrocarburosFilters
): Promise<HydrocarburosSummary> {
  return financialbiFetchJson<HydrocarburosSummary>("/v1/financialbi/hidrocarburos/summary", { method: "POST", body: input });
}

export async function searchHydrocarburosInvoices(
  _session: FrontendSession, input: HydrocarburosSearchRequest
): Promise<HydrocarburosSearchResponse> {
  return financialbiFetchJson<HydrocarburosSearchResponse>("/v1/financialbi/hidrocarburos/invoices/search", { method: "POST", body: input });
}

export async function getHydrocarburosInvoice(
  _session: FrontendSession, uuid: string
): Promise<HydrocarburosInvoiceDetail> {
  return financialbiFetchJson<HydrocarburosInvoiceDetail>(`/v1/financialbi/hidrocarburos/invoices/${encodeURIComponent(uuid)}`);
}

export async function getAprobacionCompras(_session: FrontendSession): Promise<AprobacionQueue> {
  return financialbiFetchJson<AprobacionQueue>("/v1/financialbi/hidrocarburos/aprobacion/compras");
}

export async function getAprobacionGerencia(_session: FrontendSession): Promise<AprobacionQueue> {
  return financialbiFetchJson<AprobacionQueue>("/v1/financialbi/hidrocarburos/aprobacion/gerencia");
}

export async function getAprobacionCatalogCeco(_session: FrontendSession): Promise<AprobacionCatalog> {
  return financialbiFetchJson<AprobacionCatalog>("/v1/financialbi/hidrocarburos/aprobacion/catalogo/ceco");
}

export async function getAprobacionCatalogSitios(_session: FrontendSession): Promise<AprobacionCatalog> {
  return financialbiFetchJson<AprobacionCatalog>("/v1/financialbi/hidrocarburos/aprobacion/catalogo/sitios");
}
