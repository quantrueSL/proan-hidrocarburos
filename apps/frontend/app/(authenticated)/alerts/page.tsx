import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import {
  getFinancialbiAlerts,
  getFinancialbiAlertsMtd,
  getFinancialbiCatalog,
  getFinancialbiHistorias,
  getFinancialbiHistoriasMtd
} from "@/lib/gateway";
import { AlertsWorkspace } from "@/features/alerts/alerts-workspace";
import type {
  FinancialbiAlertsMtdResponse,
  FinancialbiAlertsResponse,
  FinancialbiCatalog,
  FinancialbiHistoriasMtdResponse,
  FinancialbiHistoriasResponse
} from "@/types/financialbi";
import { clientConfig, getDefaultAuthenticatedRoute } from "../../../client.config";

function resolveDefaults(catalog: FinancialbiCatalog) {
  const ultimoMes = catalog.ultimo_mes ?? catalog.meses[catalog.meses.length - 1] ?? "2025-01";
  return {
    period: ultimoMes
  };
}

export default async function AlertsPage() {
  if (!clientConfig.features.alerts.enabled) {
    redirect(getDefaultAuthenticatedRoute());
  }

  const session = requireSession();

  let initialCatalog: FinancialbiCatalog = {
    meses: [],
    sociedades: [],
    ultimo_mes: null
  };
  let initialAlerts: FinancialbiAlertsResponse | null = null;
  let initialHistorias: FinancialbiHistoriasResponse | null = null;
  let initialAlertsMtd: FinancialbiAlertsMtdResponse | null = null;
  let initialHistoriasMtd: FinancialbiHistoriasMtdResponse | null = null;
  let initialError: string | null = null;

  // El "ritmo" (mes a la fecha) es best-effort: si falla no debe romper la
  // vista mensual, que es la que carga por defecto.
  const ritmoPromise = Promise.all([
    getFinancialbiAlertsMtd(session),
    getFinancialbiHistoriasMtd(session)
  ]).catch(() => null);

  try {
    const catalogResponse = await getFinancialbiCatalog(session);
    initialCatalog = catalogResponse.shared;
    const defaults = resolveDefaults(initialCatalog);

    const [alerts, historias, ritmo] = await Promise.all([
      getFinancialbiAlerts(session, {
        target_period: defaults.period
      }),
      getFinancialbiHistorias(session, {
        target_period: defaults.period
      }),
      ritmoPromise
    ]);

    initialAlerts = alerts;
    initialHistorias = historias;
    if (ritmo) {
      [initialAlertsMtd, initialHistoriasMtd] = ritmo;
    }

    return (
      <AlertsWorkspace
        initialAlerts={initialAlerts}
        initialAlertsMtd={initialAlertsMtd}
        initialCatalog={initialCatalog}
        initialError={null}
        initialFilters={defaults}
        initialHistorias={initialHistorias}
        initialHistoriasMtd={initialHistoriasMtd}
      />
    );
  } catch (error) {
    initialError =
      error instanceof Error
        ? error.message
        : "No se pudieron preparar las alertas financieras.";
  }

  return (
    <AlertsWorkspace
      initialAlerts={initialAlerts}
      initialAlertsMtd={initialAlertsMtd}
      initialCatalog={initialCatalog}
      initialError={initialError}
      initialFilters={{
        period: "2025-01"
      }}
      initialHistorias={initialHistorias}
      initialHistoriasMtd={initialHistoriasMtd}
    />
  );
}
