import { requireSession } from "@/lib/auth/session";
import {
  getAprobacionCatalogCeco,
  getAprobacionCatalogSitios,
  getAprobacionCompras,
  getAprobacionHistorial
} from "@/lib/gateway";
import { AprobacionWorkspace } from "@/features/aprobacion/aprobacion-workspace";
import type { AprobacionCatalog, AprobacionQueue } from "@/types/aprobacion";

// M2 · Portal de Compras (Módulo 2 de la propuesta): la validación humana --
// captura de CECO/sitio y "Validar". Historial (reabrir/reeditar) vive aquí
// porque reabrir devuelve la factura a Compras. Gerencia (Módulo 3) está en /aprobacion.
export default async function ComprasPage() {
  const session = requireSession();
  let compras: AprobacionQueue = { rows: [] };
  let historial: AprobacionQueue = { rows: [] };
  let cecos: AprobacionCatalog = { rows: [] };
  let sitios: AprobacionCatalog = { rows: [] };
  let error: string | null = null;

  try {
    [compras, historial, cecos, sitios] = await Promise.all([
      getAprobacionCompras(session),
      getAprobacionHistorial(session),
      getAprobacionCatalogCeco(session),
      getAprobacionCatalogSitios(session)
    ]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No se pudo preparar el portal de compras.";
  }

  return <AprobacionWorkspace cecos={cecos.rows} initialError={error} initialCompras={compras.rows} initialGerencia={[]} initialHistorial={historial.rows} sitios={sitios.rows} usuario={session.email} roles={["compras", "historial"]} moduleLabel="M2" title="Portal de Compras" />;
}
