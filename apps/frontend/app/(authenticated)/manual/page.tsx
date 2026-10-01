import { ManualWorkspace } from "@/features/manual/manual-workspace";
import { requireSession } from "@/lib/auth/session";
import { getDashboard, getHydrocarburosCatalog } from "@/lib/gateway";
import { buildManualStats } from "@/lib/manual-stats";

export default async function ManualPage() {
  const session = requireSession();
  // Sin filtros: es la misma consulta (y la misma caché de 5 min) que el resumen inicial del Dashboard,
  // así las cifras del manual coinciden con las del Dashboard y nunca quedan fijadas en el código.
  const [dashboard, catalog] = await Promise.allSettled([getDashboard(session), getHydrocarburosCatalog(session)]);
  if (dashboard.status === "rejected") console.error("Manual: no se pudieron cargar las cifras de conciliación", dashboard.reason);

  const stats = dashboard.status === "fulfilled"
    ? buildManualStats(dashboard.value.resumen, catalog.status === "fulfilled" ? catalog.value.ultima_actualizacion : null)
    : null;

  return <ManualWorkspace stats={stats} />;
}
