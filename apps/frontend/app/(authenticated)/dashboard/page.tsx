import { requireSession } from "@/lib/auth/session";
import { getDashboard, getHydrocarburosCatalog } from "@/lib/gateway";
import { DashboardWorkspace } from "@/features/dashboard/dashboard-workspace";
import type { DashboardData } from "@/types/dashboard";
import type { HydrocarburosCatalog } from "@/types/hidrocarburos";

export default async function DashboardPage() {
  const session = requireSession();
  let data: DashboardData | null = null;
  // Reutiliza el catálogo de M1 (misma tabla de origen) para el filtro de Proveedor.
  let catalog: HydrocarburosCatalog = { fecha_minima: null, fecha_maxima: null, proveedores: [], sitios: [], claves_sat: [] };
  let error: string | null = null;

  try {
    [data, catalog] = await Promise.all([getDashboard(session), getHydrocarburosCatalog(session)]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No se pudo preparar el dashboard.";
  }

  return <DashboardWorkspace initialData={data} initialError={error} proveedores={catalog.proveedores} ultimaActualizacion={catalog.ultima_actualizacion} />;
}
