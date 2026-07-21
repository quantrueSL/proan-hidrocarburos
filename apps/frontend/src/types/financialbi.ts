export type FinancialbiCatalog = {
  meses: string[];
  sociedades: string[];
  ultimo_mes: string | null;
  // Presentes solo en el backend BigQuery (Maka) — Azure SQL (Nutrex) los omite.
  familias?: string[];
  canales?: string[];
  lineas_negocio?: string[];
  plantas?: string[];
};

export type FinancialbiCatalogResponse = {
  shared: FinancialbiCatalog;
  report?: FinancialbiCatalog;
  alerts?: FinancialbiCatalog;
};

export type FinancialbiRequest = {
  target_period?: string | null;
  sociedad?: string | null;
  lang?: string;
  start_period?: string | null;
  end_period?: string | null;
  view_mode?: "pg" | "eur_ton" | "solvencia" | "sales" | "prod" | "flujo" | "clients_geo";
  // Filtros P&G Maka (solo BigQuery): línea de negocio (GSBER) y planta (WERKS).
  linea_negocio?: string | null;
  planta?: string | null;
  // Ventas Maka (solo BigQuery).
  familia?: string | null;
  canal?: string | null;
  // Ventas Maka (solo BigQuery): incluir facturación intercompañía PAN<->MPE.
  incluir_partes_relacionadas?: boolean;
  // Carga parcial por pestaña (REPORT_SECTIONS del backend). Omitido → todo.
  sections?: string[];
};

export type FinancialbiAskRequest = {
  question: string;
  report_context: string;
  report_lineage: string;
  sociedad: string;
  sociedad_code?: string;
  start_period: string;
  end_period: string;
  view_mode?: string;
  data_source?: "gold" | "silver2";
  lang?: string;
  session_id: string;
};

export type JsonifiedDataFrame = {
  __df__: {
    columns: string[];
    data: unknown[][];
  };
};

export type FinancialbiMetric = {
  valor?: number | null;
  delta?: number | null;
};

export type FinancialbiSummary = {
  periodo?: string;
  periodo_inicio?: string;
  periodo_cierre?: string;
  sociedad?: string;
  kpis?: Record<string, FinancialbiMetric>;
  sales_kpis?: Record<string, number | null>;
  prod_kpis?: Record<string, number | null>;
  margen_kpis?: Record<string, number | null>;
  margen_by_family?: JsonifiedDataFrame;
  margen_by_product?: JsonifiedDataFrame;
  margen_by_canal?: JsonifiedDataFrame;
  margen_trend?: JsonifiedDataFrame;
  pyg_month_cols?: string[];
  tons_by_col?: Record<string, number>;
  revenue_trend?: JsonifiedDataFrame;
  revenue_by_family?: JsonifiedDataFrame;
  top_production?: JsonifiedDataFrame;
  top_clients?: JsonifiedDataFrame;
  top_products?: JsonifiedDataFrame;
  prod_vs_fact?: JsonifiedDataFrame;
  pyg?: JsonifiedDataFrame;
  pyg_range?: JsonifiedDataFrame;
  pyg_eur_ton?: JsonifiedDataFrame;
  vol_by_family_month?: JsonifiedDataFrame;
  vol_by_categoria_month?: JsonifiedDataFrame;
  sales_revenue_by_family?: JsonifiedDataFrame;
  top_products_month?: JsonifiedDataFrame;
  prod_vs_fact_month?: JsonifiedDataFrame;
  clients_by_month?: JsonifiedDataFrame;
  top_production_by_month?: JsonifiedDataFrame;
  prod_by_family_month?: JsonifiedDataFrame;
  solvencia?: JsonifiedDataFrame;
  flujo?: JsonifiedDataFrame;
  sales_by_region?: JsonifiedDataFrame;
  region_family_matrix?: JsonifiedDataFrame;
  acreedores?: JsonifiedDataFrame;
  deudores?: JsonifiedDataFrame;
  acreedores_trend?: JsonifiedDataFrame;
  deudores_trend?: JsonifiedDataFrame;
  [key: string]: unknown;
};

export type FinancialbiReportResponse = {
  summary: FinancialbiSummary;
  view_mode?: string;
  // Set by financialbi's app.py:_cached_report_payload — "gold" when the
  // whole requested range came from the materialized gold layer, "silver2"
  // when it fell back to a live recompute.
  data_source?: "gold" | "silver2";
  [key: string]: unknown;
};

export type FinancialbiAskResponse = {
  answer?: string;
  sql_query?: string;
  rows?: Record<string, unknown>[];
  error?: string;
  // true = la respuesta salió del fallback SQL (BigQuery); false/ausente = del
  // contexto del reporte en pantalla. Señal determinista para etiquetar la fuente.
  used_exploration?: boolean;
};

export type FinancialbiAlertRow = Record<string, unknown>;

export type FinancialbiAlertsResponse = {
  target_period?: string | null;
  total_alertas?: number;
  tier_counts?: Record<string, number>;
  rows: FinancialbiAlertRow[];
};

export type FinancialbiHistoria = Record<string, unknown>;

export type FinancialbiHistoriasResponse = {
  target_period?: string | null;
  total_historias?: number;
  historias: FinancialbiHistoria[];
};

// "Ritmo" (mes a la fecha) — mismo mes en curso, sin filtros. too_early=true
// significa que todavía no llegamos al día mínimo del mes (ver MTD_MIN_DAY
// en alertas_engine.py) y los campos de conteo/filas vienen vacíos.
export type FinancialbiAlertsMtdResponse = {
  too_early: boolean;
  day_of_month: number;
  min_day?: number;
  cutoff_day?: number | null;
  total_alertas: number;
  tier_counts: Record<string, number>;
  rows: FinancialbiAlertRow[];
};

export type FinancialbiHistoriasMtdResponse = {
  too_early: boolean;
  day_of_month: number;
  min_day?: number;
  cutoff_day?: number | null;
  target_period?: string | null;
  total_historias: number;
  historias: FinancialbiHistoria[];
};
