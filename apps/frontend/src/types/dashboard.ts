export type DashboardResumen = {
  total_facturas: number;
  validadas: number;
  aprobadas: number;
  rechazadas: number;
  pendientes: number;
  pendientes_gerencia: number;
  importe_gas_total: number;
  vigentes_sat: number;
  canceladas_sat: number;
  sin_confirmar_sat: number;
  // Cobertura de validación (jul-2026, para el donut "Validado SAP" del dashboard).
  validadas_sap: number;
  mseg_alta: number;
  mseg_media: number;
  mseg_sin_evidencia: number;
};

export type DashboardGastoItem = {
  filtro: string;
  grupo: string;
  importe_gas: number;
  n_facturas: number;
  volumen_litros: number;
};

export type DashboardData = {
  resumen: DashboardResumen;
  gasto_por_proveedor: DashboardGastoItem[];
  gasto_por_sitio: DashboardGastoItem[];
  // Agrupado por CECO real, con nombre resuelto vía catálogo SAP (CSKT).
  // Facturas cuyo documento MSEG reparte el gasto entre varios centros sin
  // uno dominante caen en el grupo "Varios CECO (sin confirmar)".
  gasto_por_ceco: DashboardGastoItem[];
  // Agrupado por Núcleo (dim_nucleo_draft, propuesta Methagas x catálogo SAP
  // real -- ago-2026). Solo cuenta el CeCo si su fila del cruce está
  // estado='confirmado'; el resto (fuera de alcance, o pendiente_confirmar)
  // cae en "Sin núcleo asignado", el grupo mayoritario esperado hoy.
  gasto_por_nucleo: DashboardGastoItem[];
  gasto_por_periodo: DashboardGastoItem[];
};

export type DashboardSatInvoice = {
  uuid: string;
  serie: string | null;
  folio: string | null;
  fecha: string | null;
  proveedor: string;
  importe_gas: number | null;
  estatus_sat: "cancelado" | "sin_confirmar";
};

export type DashboardSatDetail = {
  total: number;
  canceladas: number;
  sin_confirmar: number;
  rows: DashboardSatInvoice[];
};

export type DashboardInvoice = {
  uuid: string;
  serie: string | null;
  folio: string | null;
  fecha: string | null;
  proveedor: string;
  importe_gas: number;
  volumen_litros: number;
  estado_aprobacion: "pendiente_validacion_compras" | "pendiente_aprobacion_gerencia" | "aprobada" | "rechazada";
  estado_sap: "validada_sap" | "sin_match_sap";
  confianza_mseg: "Alta" | "Media" | "sin_evidencia";
  estatus_sat: "vigente" | "cancelado" | "sin_confirmar";
  sitio: string;
  ceco: string | null;
  nucleo: string | null;
};

export type DashboardInvoiceDetail = {
  total: number;
  rows: DashboardInvoice[];
};

export type DashboardFiltros = {
  fecha_desde?: string | null;
  fecha_hasta?: string | null;
  proveedor_id?: string | null;
  estado_sap?: "validada_sap" | "sin_match_sap" | null;
  confianza_mseg?: "Alta" | "Media" | "sin_evidencia" | null;
  estatus_sat?: "vigente" | "cancelado" | "sin_confirmar" | null;
  periodo?: string | null;
  sitio?: string | null;
  ceco?: string | null;
  estado_aprobacion?: "pendiente_validacion_compras" | "pendiente_aprobacion_gerencia" | "aprobada" | "rechazada" | null;
  nucleo?: string | null;
};
