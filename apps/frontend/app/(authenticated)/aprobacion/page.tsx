import { requireSession } from "@/lib/auth/session";
import { getAprobacionGerencia } from "@/lib/gateway";
import { AprobacionWorkspace } from "@/features/aprobacion/aprobacion-workspace";
import type { AprobacionQueue } from "@/types/aprobacion";

// M3 · Aprobación Gerencial (Módulo 3 de la propuesta): one-tap sobre las
// facturas ya validadas por Compras. La captura de CECO/sitio y el Historial
// viven en /compras (Módulo 2). Gerencia solo aprueba/rechaza -- no necesita
// los catálogos de CECO/sitio (solo se usan en el formulario de captura).
export default async function AprobacionPage() {
  const session = requireSession();
  let gerencia: AprobacionQueue = { rows: [] };
  let error: string | null = null;

  try {
    gerencia = await getAprobacionGerencia(session);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No se pudo preparar la bandeja de aprobación.";
  }

  return <AprobacionWorkspace cecos={[]} initialError={error} initialCompras={[]} initialGerencia={gerencia.rows} initialHistorial={[]} sitios={[]} usuario={session.email} roles={["gerencia"]} moduleLabel="M3" title="Aprobación" />;
}
