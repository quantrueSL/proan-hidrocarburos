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
  claves_gas?: string[] | null;
};
export type HydrocarburosSearchResponse = { total: number; page: number; page_size: number; rows: HydrocarburosInvoiceRow[] };
// Línea de gas que clasificó la factura (M1) -- evidencia de "por qué es gas".
export type HydrocarburosConceptoGas = {
  clave: string | null; descripcion: string | null; cantidad: number | null;
  clave_unidad: string | null; valor_unitario: number | null; importe: number | null;
};
export type HydrocarburosInvoiceDetail = HydrocarburosInvoiceRow & {
  folio_key: string | null; folio_numero: string | null; emisor_rfc: string | null;
  receptor_rfc: string | null; fecha_timbrado: string | null;
  tipo_de_comprobante: string | null; moneda: string | null; metodo_pago: string | null;
  forma_pago: string | null; subtotal: number | null; total: number | null;
  total_impuestos_trasladados: number | null; n_lineas_gas: number | null;
  n_lineas_total: number | null; conceptos_gas?: HydrocarburosConceptoGas[] | null;
  tipo_match_sap: string | null; belnr_sap: string | null; fecha_registro_sap: string | null;
  dias_diferencia: number | null; tipo_match_sitio: string | null;
  mseg_cantidad: number | null; mseg_valor_unitario: number | null; mseg_importe: number | null;
};
