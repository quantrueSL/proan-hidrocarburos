import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getFinancialbiCatalog, getFinancialbiReport } from "@/lib/gateway";
import { ReportWorkspace } from "@/features/report/report-workspace";
import type { FinancialbiCatalog, FinancialbiReportResponse } from "@/types/financialbi";
import { clientConfig, getDefaultAuthenticatedRoute } from "../../../client.config";

function resolveDefaults(catalog: FinancialbiCatalog) {
  const ultimoMes = catalog.ultimo_mes ?? catalog.meses[catalog.meses.length - 1] ?? "2025-01";
  const [year] = ultimoMes.split("-");
  const firstPeriodOfYear =
    catalog.meses.find((period) => period === `${year}-01`) ??
    catalog.meses.find((period) => period.startsWith(`${year}-`)) ??
    ultimoMes;

  return {
    sociedad: catalog.sociedades.includes("S01") ? "S01" : catalog.sociedades[0] ?? "",
    startPeriod: firstPeriodOfYear,
    endPeriod: ultimoMes,
    viewMode: "pg" as const,
    lineaNegocio: "",
    planta: "",
    familia: "",
    canal: "",
    incluirPartesRelacionadas: false
  };
}

export default async function ReportPage() {
  if (!clientConfig.features.report.enabled) {
    redirect(getDefaultAuthenticatedRoute());
  }

  const session = requireSession();

  let initialCatalog: FinancialbiCatalog = {
    meses: [],
    sociedades: [],
    ultimo_mes: null
  };
  let initialData: FinancialbiReportResponse | null = null;
  let initialError: string | null = null;

  try {
    const catalogResponse = await getFinancialbiCatalog(session);
    initialCatalog = catalogResponse.shared;
    const defaults = resolveDefaults(initialCatalog);
    initialData = await getFinancialbiReport(session, {
      sociedad: defaults.sociedad,
      start_period: defaults.startPeriod,
      end_period: defaults.endPeriod,
      view_mode: defaults.viewMode,
      sections: ["pyg"]
    });

    return (
      <ReportWorkspace
        initialCatalog={initialCatalog}
        initialData={initialData}
        initialError={null}
        initialFilters={defaults}
      />
    );
  } catch (error) {
    initialError =
      error instanceof Error
        ? error.message
        : "No se pudo preparar el reporte financiero.";
  }

  return (
    <ReportWorkspace
      initialCatalog={initialCatalog}
      initialData={initialData}
      initialError={initialError}
      initialFilters={{
        sociedad: "S01",
        startPeriod: "2025-01",
        endPeriod: "2025-01",
        viewMode: "pg",
        lineaNegocio: "",
        planta: "",
        familia: "",
        canal: "",
        incluirPartesRelacionadas: false
      }}
    />
  );
}
