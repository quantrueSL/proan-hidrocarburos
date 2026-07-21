import { getFinancialbiServiceUrl } from "@/lib/env";
import type { FrontendSession } from "@/types/auth";
import type {
  FinancialbiAlertsMtdResponse,
  FinancialbiAlertsResponse,
  FinancialbiCatalogResponse,
  FinancialbiHistoriasMtdResponse,
  FinancialbiHistoriasResponse,
  FinancialbiReportResponse,
  FinancialbiRequest
} from "@/types/financialbi";
import type { UserRead } from "@/types/gateway";

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

export async function getFinancialbiCatalog(
  _session: FrontendSession
): Promise<FinancialbiCatalogResponse> {
  return financialbiFetchJson<FinancialbiCatalogResponse>("/v1/financialbi/catalog");
}

export async function getFinancialbiReport(
  _session: FrontendSession,
  input: FinancialbiRequest
): Promise<FinancialbiReportResponse> {
  return financialbiFetchJson<FinancialbiReportResponse>("/v1/financialbi/report", {
    method: "POST",
    body: input
  });
}

export async function getFinancialbiAlerts(
  _session: FrontendSession,
  input: FinancialbiRequest
): Promise<FinancialbiAlertsResponse> {
  return financialbiFetchJson<FinancialbiAlertsResponse>("/v1/financialbi/alerts", {
    method: "POST",
    body: input
  });
}

export async function getFinancialbiHistorias(
  _session: FrontendSession,
  input: FinancialbiRequest
): Promise<FinancialbiHistoriasResponse> {
  return financialbiFetchJson<FinancialbiHistoriasResponse>("/v1/financialbi/historias", {
    method: "POST",
    body: input
  });
}

export async function getFinancialbiAlertsMtd(
  _session: FrontendSession
): Promise<FinancialbiAlertsMtdResponse> {
  return financialbiFetchJson<FinancialbiAlertsMtdResponse>("/v1/financialbi/alerts_mtd");
}

export async function getFinancialbiHistoriasMtd(
  _session: FrontendSession
): Promise<FinancialbiHistoriasMtdResponse> {
  return financialbiFetchJson<FinancialbiHistoriasMtdResponse>("/v1/financialbi/historias_mtd");
}
