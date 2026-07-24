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
  tiene_recepcion_mseg: boolean | null;
  mseg_cantidad: number | null;
  mseg_valor_unitario: number | null;
  mseg_importe: number | null;
};

export type AprobacionQueue = { rows: AprobacionInvoice[] };
export type AprobacionCatalog = { rows: AprobacionOption[] };
export type AprobacionActionResult = { ok: boolean; estado: string };
