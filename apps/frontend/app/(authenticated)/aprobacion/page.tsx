import { requireSession } from "@/lib/auth/session";
import {
  getAprobacionCatalogCeco,
  getAprobacionCatalogSitios,
  getAprobacionCompras,
  getAprobacionGerencia,
  getAprobacionHistorial
} from "@/lib/gateway";
import { AprobacionWorkspace } from "@/features/aprobacion/aprobacion-workspace";
import type { AprobacionCatalog, AprobacionQueue } from "@/types/aprobacion";

export default async function AprobacionPage() {
  const session = requireSession();
  let compras: AprobacionQueue = { rows: [] };
  let gerencia: AprobacionQueue = { rows: [] };
  let historial: AprobacionQueue = { rows: [] };
  let cecos: AprobacionCatalog = { rows: [] };
  let sitios: AprobacionCatalog = { rows: [] };
  let error: string | null = null;

  try {
    [compras, gerencia, historial, cecos, sitios] = await Promise.all([
      getAprobacionCompras(session),
      getAprobacionGerencia(session),
      getAprobacionHistorial(session),
      getAprobacionCatalogCeco(session),
      getAprobacionCatalogSitios(session)
    ]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No se pudo preparar la bandeja de aprobación.";
  }

  return <AprobacionWorkspace cecos={cecos.rows} initialError={error} initialCompras={compras.rows} initialGerencia={gerencia.rows} initialHistorial={historial.rows} sitios={sitios.rows} usuario={session.email} />;
}
