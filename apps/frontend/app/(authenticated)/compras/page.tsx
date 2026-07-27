import { requireSession } from "@/lib/auth/session";
import {
  getAprobacionCatalogCeco,
  getAprobacionCatalogSitios,
  getAprobacionCompras,
  getAprobacionHistorial,
  getHydrocarburosCatalog
} from "@/lib/gateway";
import { AprobacionWorkspace } from "@/features/aprobacion/aprobacion-workspace";
import { EMPTY_APROBACION_QUEUE, type AprobacionCatalog, type AprobacionQueue } from "@/types/aprobacion";
import type { HydrocarburosCatalog } from "@/types/hidrocarburos";

// M2 · Portal de Compras (Módulo 2 de la propuesta): la validación humana --
// captura de CECO/sitio y "Validar". Historial (reabrir/reeditar) vive aquí
// porque reabrir devuelve la factura a Compras. Gerencia (Módulo 3) está en /aprobacion.
export default async function ComprasPage() {
  const session = requireSession();
  let compras: AprobacionQueue = EMPTY_APROBACION_QUEUE;
  let historial: AprobacionQueue = EMPTY_APROBACION_QUEUE;
  let cecos: AprobacionCatalog = { rows: [] };
  let sitios: AprobacionCatalog = { rows: [] };
  // Reutiliza el catálogo de M1 (misma tabla de origen) para los filtros de Proveedor/Clave SAT.
  let filtrosCatalog: HydrocarburosCatalog = { fecha_minima: null, fecha_maxima: null, proveedores: [], sitios: [], claves_sat: [] };
  let error: string | null = null;

  try {
    [compras, historial, cecos, sitios, filtrosCatalog] = await Promise.all([
      getAprobacionCompras(session),
      getAprobacionHistorial(session),
      getAprobacionCatalogCeco(session),
      getAprobacionCatalogSitios(session),
      getHydrocarburosCatalog(session)
    ]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No se pudo preparar el portal de compras.";
  }

  return <AprobacionWorkspace cecos={cecos.rows} initialError={error} initialCompras={compras} initialGerencia={EMPTY_APROBACION_QUEUE} initialHistorial={historial} sitios={sitios.rows} proveedores={filtrosCatalog.proveedores} ultimaActualizacion={filtrosCatalog.ultima_actualizacion} usuario={session.email} roles={["compras", "historial"]} />;
}
