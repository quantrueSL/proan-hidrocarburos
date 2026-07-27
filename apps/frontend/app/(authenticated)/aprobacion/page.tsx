import { requireSession } from "@/lib/auth/session";
import { getAprobacionGerencia, getHydrocarburosCatalog } from "@/lib/gateway";
import { AprobacionWorkspace } from "@/features/aprobacion/aprobacion-workspace";
import { EMPTY_APROBACION_QUEUE, type AprobacionQueue } from "@/types/aprobacion";
import type { HydrocarburosCatalog } from "@/types/hidrocarburos";

// M3 · Aprobación Gerencial (Módulo 3 de la propuesta): one-tap sobre las
// facturas ya validadas por Compras. La captura de CECO/sitio y el Historial
// viven en /compras (Módulo 2). Gerencia solo aprueba/rechaza -- no necesita
// los catálogos de CECO/sitio (solo se usan en el formulario de captura), pero
// sí los de Proveedor/Clave SAT para poder filtrar su propia bandeja.
export default async function AprobacionPage() {
  const session = requireSession();
  let gerencia: AprobacionQueue = EMPTY_APROBACION_QUEUE;
  let filtrosCatalog: HydrocarburosCatalog = { fecha_minima: null, fecha_maxima: null, proveedores: [], sitios: [], claves_sat: [] };
  let error: string | null = null;

  try {
    [gerencia, filtrosCatalog] = await Promise.all([getAprobacionGerencia(session), getHydrocarburosCatalog(session)]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No se pudo preparar la bandeja de aprobación.";
  }

  return <AprobacionWorkspace cecos={[]} initialError={error} initialCompras={EMPTY_APROBACION_QUEUE} initialGerencia={gerencia} initialHistorial={EMPTY_APROBACION_QUEUE} sitios={[]} proveedores={filtrosCatalog.proveedores} ultimaActualizacion={filtrosCatalog.ultima_actualizacion} usuario={session.email} roles={["gerencia"]} />;
}
