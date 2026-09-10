import "server-only";

import { getFacturasApiKey, getFacturasApiUrl } from "@/lib/env";
import type { FacturaDocumentType, FacturaMetadata, FacturasSearchFilters } from "@/types/facturas";

function apiUrl(path: string): string {
  return `${getFacturasApiUrl()}${path}`;
}

async function facturasFetch(path: string): Promise<Response> {
  try {
    return await fetch(apiUrl(path), {
      headers: { "x-api-key": getFacturasApiKey() },
      cache: "no-store"
    });
  } catch {
    throw new Error("No se pudo conectar con Facturas API.");
  }
}

function assertOk(response: Response): Response {
  if (response.ok) return response;
  if (response.status === 404) throw new Error("No se encontró la factura solicitada.");
  throw new Error("Facturas API no está disponible temporalmente.");
}

export async function searchFacturas(filters: FacturasSearchFilters): Promise<FacturaMetadata[]> {
  const params = new URLSearchParams();
  if (filters.fecha_desde) params.set("fecha_desde", filters.fecha_desde);
  if (filters.fecha_hasta) params.set("fecha_hasta", filters.fecha_hasta);
  for (const rfc of filters.rfc_emisor || []) params.append("rfc_emisor", rfc);
  for (const nucleo of filters.nucleo || []) params.append("nucleo", nucleo);
  params.set("limit", String(filters.limit ?? 100));
  params.set("offset", String(filters.offset ?? 0));
  const response = assertOk(await facturasFetch(`/v1/facturas?${params.toString()}`));
  return response.json() as Promise<FacturaMetadata[]>;
}

export async function getFacturaDocument(uuid: string, document: FacturaDocumentType): Promise<Response> {
  const path = document === "metadata" ? `/v1/facturas/${encodeURIComponent(uuid)}` : `/v1/facturas/${encodeURIComponent(uuid)}/${document}`;
  return assertOk(await facturasFetch(path));
}
