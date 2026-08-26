export type AprobacionOption = { id: string; nombre: string };

export type AprobacionInvoice = {
  uuid: string;
  estado: string;
  ceco: string | null;
  werks_manual: string | null;
  usuario_compras: string | null;
  fecha_validacion_compras: string | null;
  comentario_compras: string | null;
  usuario_gerencia: string | null;
  fecha_aprobacion_gerencia: string | null;
  comentario_gerencia: string | null;
  rechazada_por_rol: string | null;
  motivo_rechazo: string | null;
  reabierta_por: string | null;
  fecha_reapertura: string | null;
  motivo_reapertura: string | null;
  serie: string | null;
  folio: string | null;
  fecha: string | null;
  id_proveedor: string | null;
  proveedor: string;
  importe_gas: number | null;
  es_mixta: boolean;
  total: number | null;
  moneda: string | null;
  material_principal: string | null;
  cantidad_principal: number | null;
  clave_unidad_principal: string | null;
  claves_gas: string[];
  n_lineas_gas: number | null;
  n_lineas_total: number | null;
  estado_sap: string | null;
  fuente_sap: string | null;
  werks: string | null;
  sitio_consumo: string | null;
  direccion_sitio: string | null;
  // Evidencia SAP (Módulo 2 "consultar a SAP y mostrar").
  tipo_match_sap: string | null;
  belnr_sap: string | null;
  fecha_registro_sap: string | null;
  dias_diferencia: number | null;
  // Estado de pago (partida de proveedor BSAK/BSIK) -- base para el Módulo 4.
  estado_pago_sap: string | null;
  belnr_pago_sap: string | null;
  fecha_pago_sap: string | null;
  tipo_match_sitio: string | null;
  // 'Alta' = folio e importe casan exacto (recepción 1:1 verificable); 'Media' = solo el
  // folio casa (evidencia de recepción, pero el documento SAP suele ser consolidado y su
  // importe no reconcilia el monto de esta factura); null = sin recepción asociada.
  confianza_mseg: "Alta" | "Media" | null;
  mseg_cantidad: number | null;
  mseg_valor_unitario: number | null;
  mseg_importe: number | null;
  // Desglose por ticket de entrega (cada línea del CFDI agrupada por NoIdentificacion,
  // casada contra su línea ZEILE del documento MSEG). NULL si no hay documento emparejado.
  tickets_mseg: AprobacionMsegTicket[] | null;
  mseg_n_tickets: number | null;
  mseg_n_tickets_match: number | null;
  // Sugerencia de CECO (por ticket si TODOS casaron exacto, si no patrón de proveedor de
  // un solo sitio, si no los KOSTL del documento MSEG que casó -- uno o varios separados
  // por coma). Solo prellena, nunca bloquea.
  ceco_sugerido: string | null;
  // De dónde sale ceco_sugerido, para explicarlo en la UI (no solo mostrarlo):
  // 'ticket' = TODOS los tickets de la factura casaron su ZEILE exacta (evidencia por
  // entrega, la más precisa); 'proveedor' = este proveedor siempre usa el mismo CECO
  // (aplica aunque esta factura en concreto no tenga match MSEG); 'documento' = único CECO
  // en el documento MSEG que casó; 'documento_multiple' = el documento reparte el gasto
  // entre varios CECO sin desglose por ticket.
  ceco_sugerido_origen: "ticket" | "proveedor" | "documento" | "documento_multiple" | null;
};

export type AprobacionMsegTicket = {
  ticket: string | null;
  cantidad_ticket: number | null;
  importe_ticket: number | null;
  // NULL si este ticket en concreto no encontró su línea ZEILE (no bloquea el resto).
  ceco: string | null;
  cantidad_zeile: number | null;
  importe_zeile: number | null;
  match_exacto: boolean;
};

// Paginada igual que HydrocarburosSearchResponse (M1): 50 por página en vez de
// traer toda la cola de golpe. `resumen` son los agregados de TODA la cola
// filtrada (no solo la página visible) -- separado de `rows` igual que
// summary()/search() en hidrocarburos_engine.py, para que los KPIs no cambien
// según en qué página esté el usuario.
export type AprobacionQueue = {
  total: number;
  page: number;
  page_size: number;
  resumen: { importe_gas_total: number; validadas_sap: number; con_mseg: number };
  rows: AprobacionInvoice[];
};

export const EMPTY_APROBACION_QUEUE: AprobacionQueue = {
  total: 0, page: 1, page_size: 50, resumen: { importe_gas_total: 0, validadas_sap: 0, con_mseg: 0 }, rows: []
};
export type AprobacionCatalog = { rows: AprobacionOption[] };
export type AprobacionActionResult = { ok: boolean; estado: string };

// Mismos filtros que HydrocarburosFilters (M1) + confianza_mseg -- las colas de
// aprobación leen de la misma tabla de origen. Todo opcional/string porque viaja
// como query string (GET), no como body JSON.
export type AprobacionFiltros = {
  busqueda?: string | null;
  fecha_desde?: string | null;
  fecha_hasta?: string | null;
  proveedor_id?: string | null;
  estado_sap?: "validada_sap" | "sin_match_sap" | null;
  confianza_mseg?: "Alta" | "Media" | "sin_evidencia" | null;
  sitio?: "all" | "with_site" | "without_site";
  // Aísla las facturas SIN ninguna sugerencia de CECO (ni por ticket, ni por proveedor, ni
  // por documento) -- incluye casos con evidencia MSEG fuerte pero sin fuente de CECO (KOSTL
  // vacío en el propio origen SAP, ver README).
  ceco_sugerido?: "all" | "con_sugerencia" | "sin_sugerencia";
};

export type AprobacionSearch = AprobacionFiltros & { page?: number; page_size?: number };
