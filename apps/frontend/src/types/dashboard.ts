export type DashboardResumen = {
  total_facturas: number;
  validadas: number;
  aprobadas: number;
  rechazadas: number;
  pendientes: number;
  importe_gas_total: number;
  vigentes_sat: number;
  canceladas_sat: number;
  sin_confirmar_sat: number;
};

export type DashboardGastoItem = {
  grupo: string;
  importe_gas: number;
  n_facturas: number;
};

export type DashboardData = {
  resumen: DashboardResumen;
  gasto_por_ceco: DashboardGastoItem[];
  gasto_por_sitio: DashboardGastoItem[];
  gasto_por_periodo: DashboardGastoItem[];
};
