import { requireSession } from "@/lib/auth/session";
import {
  getHydrocarburosCatalog,
  getHydrocarburosSummary,
  searchHydrocarburosInvoices
} from "@/lib/gateway";
import { HydrocarburosWorkspace } from "@/features/hidrocarburos/hidrocarburos-workspace";
import type {
  HydrocarburosCatalog,
  HydrocarburosFilters,
  HydrocarburosSearchResponse,
  HydrocarburosSummary
} from "@/types/hidrocarburos";

export default async function HidrocarburosPage({
  searchParams
}: {
  searchParams?: { module?: string | string[] };
}) {
  const session = requireSession();
  let catalog: HydrocarburosCatalog = { fecha_minima: null, fecha_maxima: null, proveedores: [], sitios: [] };
  let summary: HydrocarburosSummary | null = null;
  let invoices: HydrocarburosSearchResponse | null = null;
  let error: string | null = null;
  let filters: HydrocarburosFilters = { sitio: "all" };

  try {
    catalog = await getHydrocarburosCatalog(session);
    filters = { fecha_desde: catalog.fecha_minima, fecha_hasta: catalog.fecha_maxima, sitio: "all" };
    [summary, invoices] = await Promise.all([
      getHydrocarburosSummary(session, filters),
      searchHydrocarburosInvoices(session, { ...filters, page: 1, page_size: 50 })
    ]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No se pudo preparar el módulo de Hidrocarburos.";
  }

  return (
    <HydrocarburosWorkspace
      initialCatalog={catalog}
      initialError={error}
      initialFilters={filters}
      initialInvoices={invoices}
      initialModule={searchParams?.module === "m2" ? "m2" : "m1"}
      initialSummary={summary}
    />
  );
}
