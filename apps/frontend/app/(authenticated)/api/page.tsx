import { requireSession } from "@/lib/auth/session";
import { getAprobacionCatalogNucleo, getHydrocarburosCatalog } from "@/lib/gateway";
import { FacturasApiWorkspace, type RfcSuggestion } from "@/features/facturas-api/facturas-api-workspace";
import type { NucleoOption } from "@/types/facturas";

const DEFAULT_GATEWAY_URL = "https://plataforma-hidrocarburos-facturas-gw-3h14pa0v.wn.gateway.dev";

export default async function ApiPage() {
  const session = requireSession();
  let nucleos: NucleoOption[] = [];
  let rfcSuggestions: RfcSuggestion[] = [];
  let error: string | null = null;
  try {
    const [catalogo, proveedores] = await Promise.all([
      getAprobacionCatalogNucleo(session),
      getHydrocarburosCatalog(session)
    ]);
    const porNombre = new Map<string, number | null>();
    for (const row of catalogo.rows) {
      if (row.nombre) porNombre.set(row.nombre, porNombre.get(row.nombre) ?? row.nucleo_id ?? null);
    }
    // Primero los que tienen ID de ControlVol (por ID) y luego el resto por nombre.
    nucleos = [...porNombre].map(([nombre, id]) => ({ nombre, id })).sort((a, b) =>
      a.id != null && b.id != null ? a.id - b.id
      : a.id != null ? -1
      : b.id != null ? 1
      : a.nombre.localeCompare(b.nombre, "es"));
    rfcSuggestions = proveedores.proveedores.flatMap((proveedor) =>
      (proveedor.rfcs || []).map((rfc) => ({ nombre: proveedor.nombre, rfc }))
    ).filter((suggestion, index, all) => all.findIndex((item) => item.rfc === suggestion.rfc) === index);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No se pudo cargar el catálogo de núcleos.";
  }

  return <FacturasApiWorkspace apiUrl={process.env.FACTURAS_API_URL?.trim() || DEFAULT_GATEWAY_URL} initialError={error} nucleos={nucleos} rfcSuggestions={rfcSuggestions} />;
}
