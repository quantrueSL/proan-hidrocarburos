export type HydrocarburosFilters = {
  fecha_desde?: string | null;
  fecha_hasta?: string | null;
  proveedor_id?: string | null;
  estado_sap?: "validada_sap" | "sin_match_sap" | null;
  sitio?: "all" | "with_site" | "without_site";
};

export type HydrocarburosSearchRequest = HydrocarburosFilters & { page?: number; page_size?: number };
export type HydrocarburosOption = { id: string; nombre: string };
export type HydrocarburosCatalog = {
  fecha_minima: string | null;
  fecha_maxima: string | null;
  proveedores: HydrocarburosOption[];
  sitios: HydrocarburosOption[];
};
export type HydrocarburosSummary = {
  facturas: number;
  importe_gas: number;
  facturas_mixtas: number;
  validadas_sap: number;
  con_sitio: number;
  con_recepcion_mseg: number;
};
export type HydrocarburosInvoiceRow = {
  uuid: string; fecha: string | null; serie: string | null; folio: string | null;
  id_proveedor: string | null; proveedor: string; importe_gas: number | null;
  es_mixta: boolean; estado_sap: "validada_sap" | "sin_match_sap";
  werks: string | null; sitio_consumo: string | null; tiene_recepcion_mseg: boolean;
};
export type HydrocarburosSearchResponse = { total: number; page: number; page_size: number; rows: HydrocarburosInvoiceRow[] };
export type HydrocarburosInvoiceDetail = HydrocarburosInvoiceRow & Record<string, string | number | boolean | null>;
