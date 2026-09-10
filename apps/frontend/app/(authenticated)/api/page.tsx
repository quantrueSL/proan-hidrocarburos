import { requireSession } from "@/lib/auth/session";
import { getAprobacionCatalogNucleo, getHydrocarburosCatalog } from "@/lib/gateway";
import { FacturasApiWorkspace, type RfcSuggestion } from "@/features/facturas-api/facturas-api-workspace";

const DEFAULT_GATEWAY_URL = "https://plataforma-hidrocarburos-facturas-gw-3h14pa0v.wn.gateway.dev";

export default async function ApiPage() {
  const session = requireSession();
  let nucleos: string[] = [];
  let rfcSuggestions: RfcSuggestion[] = [];
  let error: string | null = null;
  try {
    const [catalogo, proveedores] = await Promise.all([
      getAprobacionCatalogNucleo(session),
      getHydrocarburosCatalog(session)
    ]);
    nucleos = [...new Set(catalogo.rows.map((row) => row.nombre).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    rfcSuggestions = proveedores.proveedores.flatMap((proveedor) =>
      (proveedor.rfcs || []).map((rfc) => ({ nombre: proveedor.nombre, rfc }))
    ).filter((suggestion, index, all) => all.findIndex((item) => item.rfc === suggestion.rfc) === index);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No se pudo cargar el catálogo de núcleos.";
  }

  return <FacturasApiWorkspace apiUrl={process.env.FACTURAS_API_URL?.trim() || DEFAULT_GATEWAY_URL} initialError={error} nucleos={nucleos} rfcSuggestions={rfcSuggestions} />;
}
