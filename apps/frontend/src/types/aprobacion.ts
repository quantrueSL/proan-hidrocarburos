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
  serie: string | null;
  folio: string | null;
  fecha: string | null;
  id_proveedor: string | null;
  proveedor: string;
  importe_gas: number | null;
  es_mixta: boolean;
  estado_sap: string | null;
  werks: string | null;
  sitio_consumo: string | null;
};

export type AprobacionQueue = { rows: AprobacionInvoice[] };
export type AprobacionCatalog = { rows: AprobacionOption[] };
export type AprobacionActionResult = { ok: boolean; estado: string };
