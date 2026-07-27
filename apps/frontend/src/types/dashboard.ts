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
  grupo: string;
  importe_gas: number;
  n_facturas: number;
};

export type DashboardData = {
  resumen: DashboardResumen;
  gasto_por_proveedor: DashboardGastoItem[];
  gasto_por_sitio: DashboardGastoItem[];
  // Cobertura combinada CECO/sitio -- grupo es una de 4 categorías fijas
  // ("Con CECO y sitio", "Con CECO solo", "Con sitio solo", "Sin nada").
  cobertura_ceco_sitio: DashboardGastoItem[];
  gasto_por_periodo: DashboardGastoItem[];
};

export type DashboardFiltros = {
  fecha_desde?: string | null;
  fecha_hasta?: string | null;
  proveedor_id?: string | null;
  estado_sap?: "validada_sap" | "sin_match_sap" | null;
  confianza_mseg?: "Alta" | "Media" | "sin_evidencia" | null;
  estatus_sat?: "vigente" | "cancelado" | "sin_confirmar" | null;
};
