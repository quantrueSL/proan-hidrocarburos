import { getFinancialbiServiceUrl } from "@/lib/env";
import type { FrontendSession } from "@/types/auth";
import type {
  HydrocarburosCatalog,
  HydrocarburosFilters,
  HydrocarburosInvoiceDetail,
  HydrocarburosSearchRequest,
  HydrocarburosSearchResponse,
  HydrocarburosSummary
} from "@/types/hidrocarburos";
import type { AprobacionCatalog, AprobacionQueue, AprobacionSearch } from "@/types/aprobacion";
import type { DashboardData } from "@/types/dashboard";

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

    console.error("FinancialBI error", { path, status: response.status, detail });
    throw new Error("No se pudieron cargar los datos. Vuelve a intentarlo en unos instantes.");
  }

  return payload as T;
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

// Query string para GET -- omite valores vacíos/"all" (equivalen a "sin filtro").
function toQueryString(filters: Record<string, unknown> | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters || {})) {
    if (value !== null && value !== undefined && value !== "" && value !== "all") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function getAprobacionCompras(_session: FrontendSession, filtros?: AprobacionSearch): Promise<AprobacionQueue> {
  return financialbiFetchJson<AprobacionQueue>(`/v1/financialbi/hidrocarburos/aprobacion/compras${toQueryString(filtros)}`);
}

export async function getAprobacionGerencia(_session: FrontendSession, filtros?: AprobacionSearch): Promise<AprobacionQueue> {
  return financialbiFetchJson<AprobacionQueue>(`/v1/financialbi/hidrocarburos/aprobacion/gerencia${toQueryString(filtros)}`);
}

export async function getAprobacionHistorial(_session: FrontendSession, filtros?: AprobacionSearch): Promise<AprobacionQueue> {
  return financialbiFetchJson<AprobacionQueue>(`/v1/financialbi/hidrocarburos/aprobacion/historial${toQueryString(filtros)}`);
}

export async function getAprobacionCatalogCeco(_session: FrontendSession): Promise<AprobacionCatalog> {
  return financialbiFetchJson<AprobacionCatalog>("/v1/financialbi/hidrocarburos/aprobacion/catalogo/ceco");
}

export async function getAprobacionCatalogSitios(_session: FrontendSession): Promise<AprobacionCatalog> {
  return financialbiFetchJson<AprobacionCatalog>("/v1/financialbi/hidrocarburos/aprobacion/catalogo/sitios");
}

export async function getAprobacionCatalogNucleo(_session: FrontendSession): Promise<AprobacionCatalog> {
  return financialbiFetchJson<AprobacionCatalog>("/v1/financialbi/hidrocarburos/aprobacion/catalogo/nucleo");
}

export async function getDashboard(_session: FrontendSession, filtros?: Record<string, unknown>): Promise<DashboardData> {
  return financialbiFetchJson<DashboardData>(`/v1/financialbi/hidrocarburos/dashboard${toQueryString(filtros)}`);
}
