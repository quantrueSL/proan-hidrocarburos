export type FacturaMetadata = {
  uuid: string;
  serie: string | null;
  folio: string | null;
  fecha: string | null;
  rfc_emisor: string | null;
  nombre_emisor: string | null;
  total: number | null;
  moneda: string | null;
  estatus_cancelacion_sat: string | null;
  nucleos: string[];
  nucleo_ids: number[];
  urls: { xml: string; pdf: string };
};

// Núcleo del catálogo; `id` es el ID de ControlVol (solo los que superan el umbral).
export type NucleoOption = { nombre: string; id: number | null };

// «20 - Cajas»; sin ID, solo el nombre.
export function etiquetaNucleo(nombre: string, id: number | null | undefined): string {
  return id == null ? nombre : `${id} - ${nombre}`;
}

export type FacturasSearchFilters = {
  uuid?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
  rfc_emisor?: string[];
  nucleo?: string[];
  limit?: number;
  offset?: number;
};

export type FacturaDocumentType = "metadata" | "pdf" | "xml";
