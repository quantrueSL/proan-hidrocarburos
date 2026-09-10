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
  urls: { xml: string; pdf: string };
};

export type FacturasSearchFilters = {
  fecha_desde?: string;
  fecha_hasta?: string;
  rfc_emisor?: string[];
  nucleo?: string[];
  limit?: number;
  offset?: number;
};

export type FacturaDocumentType = "metadata" | "pdf" | "xml";
