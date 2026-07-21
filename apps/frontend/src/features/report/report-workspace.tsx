"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChatbiDataModal } from "@/features/agent/chatbi-data-modal";
import { PlotlyChart } from "@/features/agent/plotly-chart";
import type {
  FinancialbiAskResponse,
  FinancialbiCatalog,
  FinancialbiReportResponse,
  FinancialbiSummary,
  JsonifiedDataFrame
} from "@/types/financialbi";
import { clientConfig, type ReportViewModeKey } from "../../../client.config";

type ReportViewMode = ReportViewModeKey;

type ReportFilters = {
  sociedad: string;
  startPeriod: string;
  endPeriod: string;
  viewMode: ReportViewMode;
  lineaNegocio: string;
  planta: string;
  familia: string;
  canal: string;
  incluirPartesRelacionadas: boolean;
};

type ReportWorkspaceProps = {
  initialCatalog: FinancialbiCatalog;
  initialData: FinancialbiReportResponse | null;
  initialError: string | null;
  initialFilters: ReportFilters;
};

type ReportAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sqlQuery?: string | null;
  records?: Record<string, unknown>[] | null;
  // Etiqueta determinista de rango + fuente (la calcula el cliente a partir de
  // used_exploration, no el LLM — así nunca declara una fuente equivocada).
  meta?: string;
};

type ReportAssistantModalState =
  | { type: "table"; records: Record<string, unknown>[]; rowCount: number }
  | { type: "sql"; sqlQuery: string };

// Sección del backend (REPORT_SECTIONS en report_engine.py) que alimenta cada
// pestaña. pg y eur_ton comparten datos ("pyg"), así cambiar entre ellas no
// re-pide nada.
const SECTION_BY_VIEW_MODE: Record<string, string> = {
  pg: "pyg",
  eur_ton: "pyg",
  solvencia: "solvencia",
  flujo: "flujo",
  sales: "sales",
  clients_geo: "clients_geo",
  prod: "prod"
};

// Secciones que existen para las pestañas de este cliente — es lo que el
// prefetch del asistente completa en segundo plano.
const CLIENT_REPORT_SECTIONS = Array.from(
  new Set(
    clientConfig.features.report.viewModes.map(
      (mode) => SECTION_BY_VIEW_MODE[mode.key] ?? "pyg"
    )
  )
);

// Identidad de los filtros que afectan a los DATOS. viewMode queda fuera a
// propósito: cambiar de pestaña no invalida las secciones ya cargadas.
function filtersDataKey(f: ReportFilters): string {
  return JSON.stringify([
    f.sociedad,
    f.startPeriod,
    f.endPeriod,
    f.lineaNegocio,
    f.planta,
    f.familia,
    f.canal,
    f.incluirPartesRelacionadas
  ]);
}

const MONTH_SHORT = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic"
];

const MONTH_LONG = [
  "01 - Enero",
  "02 - Febrero",
  "03 - Marzo",
  "04 - Abril",
  "05 - Mayo",
  "06 - Junio",
  "07 - Julio",
  "08 - Agosto",
  "09 - Septiembre",
  "10 - Octubre",
  "11 - Noviembre",
  "12 - Diciembre"
];

const COMPANY_LABELS: Record<string, string> = {
  S01: "Nutrex",
  S02: "Natura Cria",
  S08: "SAT"
};

const VIEW_MODES = clientConfig.features.report.viewModes;

// ── Paletas de color estandarizadas ────────────────────────────────────────
const CHART_COLOR_SINGLE = "#dc6130"; // naranja marca — series únicas
const CHART_COLOR_SERIES = [          // series predefinidas (métricas)
  "#dc6130", "#7b3f00", "#f4a261", "#c5a028", "#a0522d", "#f0c878"
] as const;
const CHART_COLOR_CATEGORIES = [      // categorías dinámicas (familia, canal…)
  "#f5a623", "#dc6130", "#7b3f00", "#8baa52", "#4a7a30",
  "#d4895a", "#c8a228", "#a0522d", "#f0c878", "#5c3010"
] as const;
const SOCIEDAD_PICKER_ENABLED = clientConfig.features.report.sociedadPicker;
const DIMENSION_FILTERS_ENABLED = clientConfig.features.report.dimensionFilters;

const REPORT_ASSISTANT_ENABLED = clientConfig.features.report.assistant.enabled;
// Con la carga lazy por pestaña, el summary solo contiene las secciones que el
// usuario ha visitado — serializeReportSummary salta las claves ausentes y el
// endpoint /ask cae a ChatBI (SQL vía lineage) para datos no visibles.
const REPORT_ASSISTANT_CONTEXT_KEYS = [
  "periodo_inicio",
  "periodo_cierre",
  "sociedad",
  "pyg_range",
  "pyg_month_cols",
  "pyg_eur_ton",
  "tons_by_col",
  "sales_kpis",
  "revenue_trend",
  "vol_by_family_month",
  "vol_by_categoria_month",
  "sales_revenue_by_family",
  "top_products_month",
  "prod_vs_fact_month",
  "clients_by_month",
  "prod_kpis",
  "top_production_by_month",
  "prod_by_family_month",
  // Secciones de Rentab. Comercial, Solvencia, Flujo y Clientes/Geografía —
  // presentes en el summary gracias al prefetch del panel; sin estas claves el
  // serializador las ignoraba y sus preguntas caían innecesariamente a SQL.
  "margen_kpis",
  "margen_by_family",
  "margen_by_product",
  "margen_by_canal",
  "margen_trend",
  "solvencia",
  "flujo",
  "sales_by_region",
  "region_family_matrix",
  "acreedores",
  "deudores"
] as const;
const REPORT_ASSISTANT_MAX_ROWS = 200;
const REPORT_ASSISTANT_MAX_CHARS = 120000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDataFrame(value: unknown): value is JsonifiedDataFrame {
  return isRecord(value) && "__df__" in value && isRecord(value.__df__);
}

function getNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function monthLabel(period: string) {
  const month = Number(period.split("-")[1]);
  return Number.isFinite(month) && month >= 1 && month <= 12
    ? MONTH_SHORT[month - 1]
    : period;
}

// `monthLabel` recorta el año ("2025-01" -> "Ene"). Cuando el rango
// seleccionado cruza de año (ej. ene-2025 a mar-2026), el mismo mes
// aparece dos veces con años distintos -- mostrar solo "Ene" las dos
// veces las vuelve indistinguibles en ejes/columnas. Esta variante añade
// el año corto ("Ene 25") SOLO cuando `allPeriods` cubre más de un año;
// en el caso normal (un solo año) se comporta igual que `monthLabel`.
function monthLabelDisambiguated(period: string, allPeriods: string[]) {
  const years = new Set(allPeriods.map((p) => p.split("-")[0]).filter(Boolean));
  const base = monthLabel(period);
  if (years.size <= 1) {
    return base;
  }
  const year = period.split("-")[0];
  return year ? `${base} ${year.slice(-2)}` : base;
}

function formatPeriodLongLabel(period: string) {
  const [year, month] = period.split("-");
  const monthIndex = Number(month) - 1;
  if (!year || monthIndex < 0 || monthIndex >= MONTH_LONG.length) {
    return period;
  }

  return `${MONTH_LONG[monthIndex].replace(/^\d{2} - /, "")} ${year}`;
}

function groupPeriodsByYear(periods: string[]) {
  return periods.reduce<Record<string, Set<string>>>((accumulator, period) => {
    const [year, month] = period.split("-");
    if (!year || !month) {
      return accumulator;
    }

    accumulator[year] ??= new Set<string>();
    accumulator[year].add(month);
    return accumulator;
  }, {});
}

const REPORT_CURRENCY = clientConfig.features.report.currency;

const PYG_GROUPS = [
  {
    key: "ingresos",
    displayName: "Ingresos Brutos",
    headerConcept: "Total Ventas Brutas",
    children: new Set([
      "Ventas Brutas Materiales",
      "Ventas Brutas Croqueta",
      "Venta Alimento Cocinado",
      "Venta Artículo Mascota",
      "Venta Servicio e Intereses",
      "Otros Ingresos",
      "Otras Ventas",
    ]),
  },
  {
    key: "costos",
    displayName: "Costo de Venta",
    headerConcept: "Costo Total",
    children: new Set([
      "Costo Transformación",
      "Costo Empaque",
      "Costo Alimento",
      "Costo Materiales",
      "Costo Croqueta",
      "Costo Venta de Croqueta",
      "Costo Alimento Cocinado",
      "Costo Lofilizados",
      "Costo de Venta",
    ]),
  },
  {
    key: "gastos",
    displayName: "Gastos de Operación",
    headerConcept: null,
    children: new Set([
      "Gastos de Producción",
      "Gastos de Administración y Ventas",
      "Gastos de Operación",
    ]),
  },
];

function formatCurrency(value: unknown) {
  const numeric = getNumber(value);
  if (numeric === null) {
    return "—";
  }

  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: REPORT_CURRENCY,
    maximumFractionDigits: 0
  }).format(numeric);
}

function formatCurrencyPerTon(value: unknown) {
  const numeric = getNumber(value);
  if (numeric === null) {
    return "—";
  }

  return `${new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(numeric)} ${REPORT_CURRENCY}/T`;
}

function formatTons(value: unknown) {
  const numeric = getNumber(value);
  if (numeric === null) {
    return "—";
  }

  return `${new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 0
  }).format(numeric)} T`;
}

function formatPercentDelta(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return undefined;
  }

  return `${new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 1,
    signDisplay: "always"
  }).format(value)}%`;
}

function formatRatio(value: unknown) {
  const numeric = getNumber(value);
  return numeric === null
    ? "—"
    : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(
        numeric
      );
}

function formatRatioPercent(value: unknown) {
  const numeric = getNumber(value);
  return numeric === null ? "—" : `${formatRatio(numeric)}%`;
}

function buildMargenBarTrendSpec(rows: Array<Record<string, unknown>>, title: string) {
  if (rows.length === 0) {
    return null;
  }

  const periods = rows.map((row) => getString(row.periodo));

  return {
    data: [
      {
        type: "bar",
        x: periods.map((period) => monthLabelDisambiguated(period, periods)),
        y: rows.map((row) => getNumber(row.margen) ?? 0),
        marker: { color: CHART_COLOR_SINGLE }
      }
    ],
    layout: { title, margin: { l: 24, r: 12, t: 36, b: 24 } }
  };
}

function buildMargenPctTrendSpec(rows: Array<Record<string, unknown>>, title: string) {
  if (rows.length === 0) {
    return null;
  }

  const periods = rows.map((row) => getString(row.periodo));

  return {
    data: [
      {
        type: "scatter",
        mode: "lines+markers",
        x: periods.map((period) => monthLabelDisambiguated(period, periods)),
        y: rows.map((row) => getNumber(row.margen_pct)),
        line: { color: "#dc6130" },
        marker: { color: "#dc6130" }
      }
    ],
    layout: { title, margin: { l: 24, r: 12, t: 36, b: 24 } }
  };
}

function buildMargenTableRows(
  rows: Array<Record<string, unknown>>,
  key: string,
  label: string
) {
  return rows.map((row) => ({
    [label]: getString(row[key]) || "—",
    Ingresos: formatCurrency(row.ingresos),
    "% del total": formatRatioPercent(row.pct_ingresos),
    Margen: formatCurrency(row.margen),
    "Margen %": formatRatioPercent(row.margen_pct)
  }));
}

function formatDeudaEbitda(value: unknown) {
  const numeric = getNumber(value);
  return numeric === null ? "N/A" : formatRatio(numeric);
}

function formatFlujoVar(value: unknown) {
  const numeric = getNumber(value);
  if (numeric === null) {
    return "—";
  }

  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: REPORT_CURRENCY,
    maximumFractionDigits: 0,
    signDisplay: "always"
  }).format(numeric);
}

function formatDeltaPercent(value: unknown) {
  const numeric = getNumber(value);
  if (numeric === null) {
    return null;
  }

  return `${numeric >= 0 ? "+" : ""}${(numeric * 100).toFixed(1)}%`;
}

function formatTableValue(value: unknown) {
  const numeric = getNumber(value);
  if (numeric !== null) {
    return new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(numeric);
  }

  return String(value ?? "â€”");
}

function formatAssistantScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "â€”";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
    }
  }

  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, nestedValue]) => `${key}=${formatAssistantScalar(nestedValue)}`)
      .join(", ");
  }

  return String(value);
}

function serializeAssistantValue(key: string, value: unknown): string {
  if (isDataFrame(value)) {
    const rows = dataframeToRows(value);
    if (rows.length === 0) {
      return "";
    }

    const limitedRows = rows.slice(0, REPORT_ASSISTANT_MAX_ROWS);
    const columns = value.__df__.columns ?? [];
    const csv = [
      columns.join(","),
      ...limitedRows.map((row) =>
        columns
          .map((column) => {
            const cell = row[column];
            const text = cell === null || cell === undefined ? "" : String(cell);
            return /[,"\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
          })
          .join(",")
      )
    ].join("\n");
    const extraRows =
      rows.length > REPORT_ASSISTANT_MAX_ROWS
        ? `\n(+${rows.length - REPORT_ASSISTANT_MAX_ROWS} filas mas)`
        : "";
    return `## ${key}\n${csv}${extraRows}`;
  }

  if (isRecord(value)) {
    const lines = Object.entries(value)
      .filter(([, nestedValue]) => !isDataFrame(nestedValue))
      .map(([nestedKey, nestedValue]) => `- ${nestedKey}: ${formatAssistantScalar(nestedValue)}`);
    return lines.length > 0 ? `## ${key}\n${lines.join("\n")}` : "";
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? `${key}: ${value.join(", ")}` : "";
  }

  return `${key}: ${formatAssistantScalar(value)}`;
}

function serializeReportSummary(summary: FinancialbiSummary | null): string {
  if (!summary) {
    return "";
  }

  const parts = REPORT_ASSISTANT_CONTEXT_KEYS.map((key) =>
    key in summary ? serializeAssistantValue(key, summary[key]) : ""
  ).filter((value) => value.length > 0);
  const text = parts.join("\n\n");
  return text.length > REPORT_ASSISTANT_MAX_CHARS
    ? `${text.slice(0, REPORT_ASSISTANT_MAX_CHARS)}\n...(contexto truncado)...`
    : text;
}

function buildReportLineage(): string {
  return (
    "HOW THE REPORT FIGURES ARE COMPUTED (data lineage; use it to write SQL consistent with the figures shown).\n" +
    "TABLE PREFERENCE: for monthly aggregates PREFER the pre-aggregated GOLD tables (same numbers, cheaper): " +
    "MAKA_GOLD_MARGEN_MENSUAL (revenue/margin/tonnage by anio, mes, familia, canal), " +
    "MAKA_GOLD_MARGEN_PRODUCTO_MENSUAL (same by product), " +
    "MAKA_GOLD_REGION_FAMILIA_MENSUAL (revenue/tonnage by region), " +
    "MAKA_GOLD_CLIENTES_MES (revenue per customer/month, with/without intercompany precomputed), " +
    "MAKA_GOLD_PYG_DETALLE (columns anio, mes, concepto, seccion, es_subtotal, importe_mes, importe_ytd — the full P&G structure with DISPLAY-CORRECT signs (revenue positive, costs/losses negative) and explicit subtotals such as 'Total Ventas Netas', 'Utilidad Bruta', 'EBITDA'; PREFER this table for any P&G value AND for causal 'why did EBITDA/margin change' analysis: group by concepto and compare periods on importe_mes. CRITICAL: rows are broken down by linea_negocio/planta and there is NO single company-total row — the company figure is SUM(importe_mes) over ALL linea_negocio/planta rows; NEVER filter linea_negocio/planta IS NULL to get a total (that returns only an unassigned slice), and for an accumulated figure SUM importe_mes over the month range rather than reading importe_ytd), " +
    "MAKA_GOLD_FLUJO_PIVOT (balance-sheet flows). In gold sales tables exclude by default " +
    "canal IN ('06 - PARTES RELACIONADAS', 'Sin asignar') — note the UPPERCASE spelling there. " +
    "Fall back to the detail tables below only for invoice-line/lot/exact-date granularity.\n" +
    "Base tables (BigQuery, project proan-quantrue) — single company (MPE), no sociedad picker. " +
    "GOLD tables above live in dataset D60_REPORTING; the detail tables below live in dataset D50_AGGREGATE_RENTABILIDAD:\n" +
    "- MAKA_PYG_DETALLE: anio, mes, categoria_pyg, linea_negocio, planta, importe_bruto (RAW postings that may follow SAP credit/debit signs — revenue can appear NEGATIVE and costs POSITIVE, and a single categoria_pyg can flip sign across months due to adjustments). Do NOT rely on its raw sign for signed or causal analysis; PREFER MAKA_GOLD_PYG_DETALLE (display-correct signs) above. Use this raw table only for a categoria_pyg breakdown not available in the gold subtotals.\n" +
    "- MAKA_PYG_MENSUAL: anio, mes, ventas_netas, costo_venta, utilidad_bruta, gasto_operacion, ebitda, depreciacion, utilidad_operacion, resultado_financiero_neto, resultado_ejercicio_mensual — company-level P&G subtotals already computed, one row per month (source FI/faglflext, complete history). PREFER this table for P&G figures of a year OTHER than the report's selected year (SUM the relevant column over the months): the gold/CO P&G tables may not fully cover closed prior years.\n" +
    "- MAKA_VENTAS_RECETAS_COSTESMP: billing_date, company_code, customer_number, customer_name, material_number, material_name, familia, distribution_channel, region, amount_mxn, real_weight_kg, margen_mxn — sales detail. Exclude by default distribution_channel = '06 - PARTES RELACIONADAS' (UPPERCASE — case-sensitive, same spelling as gold), the intercompany channel, not a real market sale.\n" +
    "Tonnage = SUM(real_weight_kg) / 1000.\n\n" +
    "P&G / income-statement tabs: read MAKA_GOLD_PYG_DETALLE (concepto is the display concept, e.g. \"Ventas Brutas Materiales\", \"Costo Transformación\", \"Gastos de Administración y Ventas\", \"Depreciación\", plus subtotals like \"EBITDA\"; importe_mes / importe_ytd carry display-correct signs). For any total or accumulated figure, SUM(importe_mes) over ALL linea_negocio/planta rows and over the month range — do NOT filter linea_negocio/planta IS NULL and do NOT read importe_ytd (both give wrong totals for this table). For a causal 'why did X change' comparison, filter es_subtotal = FALSE, group by concepto and compare periods on SUM(importe_mes); NET OUT reclassifications between related concepts before naming a driver. Only fall back to MAKA_PYG_DETALLE.importe_bruto (raw, SAP signs) if a needed categoria_pyg is absent from the gold table.\n" +
    '  - "Resultado del Ejercicio" = SUM(importe_bruto) over all categoria_pyg rows for the period, or resultado_ejercicio_mensual directly from MAKA_PYG_MENSUAL.\n' +
    "  - EUR/Tonne tab = each P&G amount divided by the period invoiced tonnage.\n\n" +
    "Sales tab: from MAKA_VENTAS_RECETAS_COSTESMP over the selected range; revenue = SUM(amount_mxn); invoiced tonnage = SUM(real_weight_kg)/1000; active clients = COUNT(DISTINCT customer_number); breakdowns by familia, distribution_channel, material or customer."
  );
}

function createAssistantSessionId() {
  const uuid =
    typeof globalThis !== "undefined" && "crypto" in globalThis && globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  return `reportqa:${uuid}`;
}

function ReportChevron() {
  return (
    <svg
      aria-hidden="true"
      className="financial-report-chevron"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} />
    </svg>
  );
}

function InfoTooltip({ items }: { items: string[] }) {
  return (
    <span className="financial-info-tooltip">
      ⓘ
      <span className="financial-info-tooltip-popup">
        {items.length === 1 ? (
          items[0]
        ) : (
          <ul>
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
      </span>
    </span>
  );
}

function FilterOptionPicker({
  allLabel,
  isOpen,
  label,
  onSelect,
  onToggle,
  options,
  value,
  valueLabels
}: {
  allLabel?: string;
  isOpen: boolean;
  label: string;
  onSelect: (value: string) => void;
  onToggle: () => void;
  options: string[];
  value: string;
  valueLabels?: Record<string, string>;
}) {
  const allOptions = allLabel !== undefined ? ["", ...options] : options;
  const displayLabel = (optionValue: string) =>
    optionValue === "" ? allLabel ?? "" : valueLabels?.[optionValue] ?? optionValue;

  return (
    <div className="financial-report-inline-filter" data-report-dropdown="true">
      <button
        aria-expanded={isOpen}
        className={`financial-report-inline-filter-btn${isOpen ? " is-open" : ""}`}
        onClick={onToggle}
        type="button"
      >
        <span className="financial-report-inline-filter-lab">{label}</span>
        <span className="financial-report-inline-filter-val">{displayLabel(value)}</span>
        <ReportChevron />
      </button>

      {isOpen ? (
        <div className="financial-report-option-popover">
          {allOptions.map((optionValue) => (
            <button
              className={`financial-report-option-item${optionValue === value ? " is-selected" : ""}`}
              key={optionValue || "__all__"}
              onClick={() => onSelect(optionValue)}
              type="button"
            >
              <span>{displayLabel(optionValue)}</span>
              {optionValue === value ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PeriodPicker({
  align = "left",
  id,
  isOpen,
  label,
  onChange,
  onToggle,
  periods,
  value
}: {
  align?: "left" | "right";
  id: string;
  isOpen: boolean;
  label: string;
  onChange: (period: string) => void;
  onToggle: () => void;
  periods: string[];
  value: string;
}) {
  const periodsByYear = useMemo(() => groupPeriodsByYear(periods), [periods]);
  const years = useMemo(
    () => Object.keys(periodsByYear).sort((left, right) => right.localeCompare(left)),
    [periodsByYear]
  );
  const [selectedYear, setSelectedYear] = useState(() => value.split("-")[0] || years[0] || "");

  useEffect(() => {
    setSelectedYear(value.split("-")[0] || years[0] || "");
  }, [value, years]);

  const availableMonths = periodsByYear[selectedYear] ?? new Set<string>();
  const selectedYearIndex = years.indexOf(selectedYear);
  const previousYear = selectedYearIndex >= 0 ? years[selectedYearIndex + 1] : undefined;
  const nextYear = selectedYearIndex > 0 ? years[selectedYearIndex - 1] : undefined;

  return (
    <div className="financial-report-inline-filter" data-report-dropdown="true">
      <button
        aria-expanded={isOpen}
        className={`financial-report-inline-filter-btn${isOpen ? " is-open" : ""}`}
        id={id}
        onClick={onToggle}
        type="button"
      >
        <span className="financial-report-inline-filter-lab">{label}</span>
        <span className="financial-report-inline-filter-val">{formatPeriodLongLabel(value)}</span>
        <ReportChevron />
      </button>

      {isOpen ? (
        <div
          className={`financial-period-popover financial-report-period-popover${
            align === "right" ? " financial-report-period-popover-right" : ""
          }`}
        >
          <div className="financial-period-yearbar">
            <button
              aria-label="AÃ±o anterior"
              className="financial-period-year-nav"
              disabled={!previousYear}
              onClick={() => previousYear ? setSelectedYear(previousYear) : undefined}
              type="button"
            >
              ‹
            </button>
            <span>{selectedYear}</span>
            <button
              aria-label="AÃ±o siguiente"
              className="financial-period-year-nav"
              disabled={!nextYear}
              onClick={() => nextYear ? setSelectedYear(nextYear) : undefined}
              type="button"
            >
              ›
            </button>
          </div>
          <div className="financial-period-months">
            {MONTH_SHORT.map((monthLabel, index) => {
              const month = String(index + 1).padStart(2, "0");
              const period = `${selectedYear}-${month}`;
              const isAvailable = availableMonths.has(month);
              return (
                <button
                  className={`financial-period-month${value === period ? " is-active" : ""}`}
                  disabled={!isAvailable}
                  key={month}
                  onClick={() => onChange(period)}
                  type="button"
                >
                  <span>{monthLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function dataframeToRows(frame: unknown): Array<Record<string, unknown>> {
  if (!isDataFrame(frame)) {
    return [];
  }

  const columns = Array.isArray(frame.__df__.columns) ? frame.__df__.columns : [];
  const data = Array.isArray(frame.__df__.data) ? frame.__df__.data : [];
  return data.map((row) => {
    const rowArray = Array.isArray(row) ? row : [];
    return columns.reduce<Record<string, unknown>>((accumulator, column, index) => {
      accumulator[column] = rowArray[index];
      return accumulator;
    }, {});
  });
}

function buildMultiSeriesBarSpec(
  rows: Array<Record<string, unknown>>,
  {
    groupKeyCandidates,
    valueKey = "toneladas",
    title,
    barmode
  }: {
    groupKeyCandidates: string[];
    valueKey?: string;
    title: string;
    barmode: "stack" | "group";
  }
) {
  if (rows.length === 0) {
    return null;
  }

  const groupKey = groupKeyCandidates.find((key) => rows.some((row) => getString(row[key]).length > 0));
  if (!groupKey) {
    return null;
  }

  const groups = Array.from(
    new Set(rows.map((row) => getString(row[groupKey])).filter(Boolean))
  );
  // Clave interna SIEMPRE el periodo completo ("2025-01"), nunca la
  // etiqueta corta de mes -- esa se repite entre años y, si el rango
  // cruza de año (ej. ene-2025 a mar-2026), colapsaba ene-2025 con
  // ene-2026 en un solo punto del eje X (perdiendo uno de los dos).
  const periods = Array.from(
    new Set(rows.map((row) => getString(row.periodo)).filter(Boolean))
  ).sort();
  const xValues = periods.map((period) => monthLabelDisambiguated(period, periods));

  return {
    data: groups.map((group, i) => ({
      type: "bar",
      name: group,
      x: xValues,
      marker: { color: CHART_COLOR_CATEGORIES[i % CHART_COLOR_CATEGORIES.length] },
      y: periods.map((period) => {
        const matchingRow = rows.find(
          (row) =>
            getString(row.periodo) === period &&
            getString(row[groupKey]) === group
        );
        return getNumber(matchingRow?.[valueKey]) ?? 0;
      })
    })),
    layout: {
      title,
      barmode,
      margin: { l: 24, r: 12, t: 36, b: 24 },
      legend: { orientation: "h" }
    }
  };
}

function buildRevenueTrendSpec(rows: Array<Record<string, unknown>>, title: string) {
  if (rows.length === 0) {
    return null;
  }

  const periods = rows.map((row) => getString(row.periodo));

  return {
    data: [
      {
        type: "scatter",
        mode: "lines+markers",
        x: periods.map((period) => monthLabelDisambiguated(period, periods)),
        y: rows.map((row) => getNumber(row.ingresos) ?? 0),
        line: { color: CHART_COLOR_SINGLE, width: 3 },
        marker: { color: CHART_COLOR_SINGLE, size: 8 }
      }
    ],
    layout: {
      title,
      margin: { l: 24, r: 12, t: 36, b: 24 }
    }
  };
}

function buildMultiSeriesLineSpec(
  rows: Array<Record<string, unknown>>,
  series: Array<{ key: string; name: string; color: string }>
) {
  if (rows.length === 0) {
    return null;
  }

  const periods = rows.map((row) => getString(row.periodo));
  const xValues = periods.map((period) => monthLabelDisambiguated(period, periods));

  return {
    data: series.map((s) => ({
      type: "scatter",
      mode: "lines+markers",
      name: s.name,
      x: xValues,
      y: rows.map((row) => getNumber(row[s.key])),
      line: { color: s.color, width: 3 },
      marker: { color: s.color, size: 7 }
    })),
    layout: {
      margin: { l: 24, r: 12, t: 12, b: 24 },
      legend: { orientation: "h" }
    }
  };
}

const FLUJO_BLOQUE_COLORS: Record<string, string> = {
  activo: CHART_COLOR_SERIES[0],
  pasivo: CHART_COLOR_SERIES[1],
  capital: CHART_COLOR_SERIES[2]
};
const FLUJO_BLOQUE_LABELS: Record<string, string> = {
  activo: "Activo",
  pasivo: "Pasivo",
  capital: "Capital"
};

const AGING_BUCKETS: Array<{ key: string; label: string; color: string }> = [
  { key: "sin_vencer", label: "Sin vencer", color: "#9CA3AF" },
  { key: "bucket_0_30", label: "0-30 días", color: "#F4B400" },
  { key: "bucket_31_60", label: "31-60 días", color: "#FB8C00" },
  { key: "bucket_61_90", label: "61-90 días", color: "#EF5350" },
  { key: "bucket_90_mas", label: "90+ días", color: "#8b0000" }
];

function computeAgingTotals(rows: Array<Record<string, unknown>>) {
  const totals: Record<string, number> = {};
  AGING_BUCKETS.forEach((bucket) => {
    totals[bucket.key] = 0;
  });
  rows.forEach((row) => {
    AGING_BUCKETS.forEach((bucket) => {
      totals[bucket.key] += getNumber(row[bucket.key]) ?? 0;
    });
  });
  return totals;
}

function buildStackedAgingBarSpec(bucketTotals: Record<string, number>, chartLabel: string) {
  const grandTotal = Object.values(bucketTotals).reduce((sum, value) => sum + value, 0);
  if (grandTotal <= 0) {
    return null;
  }

  return {
    data: AGING_BUCKETS.map((bucket) => ({
      type: "bar",
      orientation: "h",
      name: bucket.label,
      x: [bucketTotals[bucket.key] ?? 0],
      y: [chartLabel],
      marker: { color: bucket.color }
    })),
    layout: {
      barmode: "stack",
      margin: { l: 10, r: 10, t: 8, b: 8 },
      legend: { orientation: "h" },
      yaxis: { showticklabels: false }
    }
  };
}

function buildAgingTrendSpec(rows: Array<Record<string, unknown>>, title: string) {
  if (rows.length === 0) {
    return null;
  }

  const agingPeriods = rows.map((row) => getString(row.periodo));
  const xValues = agingPeriods.map((period) => monthLabelDisambiguated(period, agingPeriods));

  return {
    data: AGING_BUCKETS.map((bucket) => ({
      type: "bar",
      name: bucket.label,
      x: xValues,
      y: rows.map((row) => getNumber(row[bucket.key]) ?? 0),
      marker: { color: bucket.color }
    })),
    layout: {
      title,
      barmode: "stack",
      margin: { l: 24, r: 12, t: 36, b: 24 },
      legend: { orientation: "h", y: -0.25 },
      xaxis: { tickfont: { size: 10 } },
      yaxis: { tickfont: { size: 10 } }
    }
  };
}

function buildCounterpartyTrendSpec(
  acreedoresTrendRows: Array<Record<string, unknown>>,
  deudoresTrendRows: Array<Record<string, unknown>>,
  title: string
) {
  if (acreedoresTrendRows.length === 0 && deudoresTrendRows.length === 0) {
    return null;
  }

  const data: unknown[] = [];
  if (acreedoresTrendRows.length > 0) {
    const acreedoresPeriods = acreedoresTrendRows.map((row) => getString(row.periodo));
    data.push({
      type: "scatter",
      mode: "lines+markers",
      name: "Acreedores",
      x: acreedoresPeriods.map((period) => monthLabelDisambiguated(period, acreedoresPeriods)),
      y: acreedoresTrendRows.map((row) => getNumber(row.saldo_neto) ?? 0),
      line: { color: CHART_COLOR_SERIES[0] },
      marker: { color: CHART_COLOR_SERIES[0] }
    });
  }
  if (deudoresTrendRows.length > 0) {
    const deudoresPeriods = deudoresTrendRows.map((row) => getString(row.periodo));
    data.push({
      type: "scatter",
      mode: "lines+markers",
      name: "Deudores",
      x: deudoresPeriods.map((period) => monthLabelDisambiguated(period, deudoresPeriods)),
      y: deudoresTrendRows.map((row) => getNumber(row.saldo_neto) ?? 0),
      line: { color: CHART_COLOR_SERIES[1] },
      marker: { color: CHART_COLOR_SERIES[1] }
    });
  }

  return {
    data,
    layout: {
      title,
      margin: { l: 24, r: 12, t: 36, b: 24 },
      legend: { orientation: "h", y: -0.25 },
      xaxis: { tickfont: { size: 10 } },
      yaxis: { tickfont: { size: 10 } }
    }
  };
}

function formatDays(value: unknown) {
  const numeric = getNumber(value);
  return numeric === null
    ? "—"
    : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(
        numeric
      );
}

function buildFechaFotoCaption(
  acreedoresRows: Array<Record<string, unknown>>,
  deudoresRows: Array<Record<string, unknown>>,
  endPeriod: string
) {
  for (const rows of [acreedoresRows, deudoresRows]) {
    const row = rows[0];
    if (!row || !row.fecha_foto) {
      continue;
    }

    const anio = getNumber(row.anio);
    const mes = getNumber(row.mes);
    const fecha = getString(row.fecha_foto).slice(0, 10);
    const mesMostrado = anio && mes ? `${anio}-${String(mes).padStart(2, "0")}` : null;
    const base = `Foto del saldo pendiente al cierre de ${
      mesMostrado ? formatPeriodLongLabel(mesMostrado) : "—"
    } (fecha exacta: ${fecha})`;

    if (mesMostrado && endPeriod && mesMostrado !== endPeriod) {
      return `${base} — no hay foto para ${formatPeriodLongLabel(
        endPeriod
      )}; se muestra el mes disponible más reciente hasta esa fecha.`;
    }
    return `${base} — responde al mes de CIERRE de arriba, no al rango completo.`;
  }

  return (
    "Sin foto de acreedores/deudores disponible para el periodo seleccionado " +
    "(los datos empiezan en jun-2025 / jul-2024)."
  );
}

function renderCounterpartyColumn(
  title: string,
  rows: Array<Record<string, unknown>>,
  isCreditor: boolean
) {
  if (rows.length === 0) {
    return (
      <div className="financial-report-counterparty-column" key={title}>
        <h3>{title}</h3>
        <p className="muted">Sin datos disponibles para el periodo seleccionado.</p>
      </div>
    );
  }

  const bucketTotals = computeAgingTotals(rows);
  const agingSpec = buildStackedAgingBarSpec(bucketTotals, title);
  const total = rows.reduce((sum, row) => sum + (getNumber(row.saldo_neto) ?? 0), 0);
  const top5 = [...rows]
    .sort(
      (left, right) =>
        Math.abs(getNumber(right.saldo_neto) ?? 0) - Math.abs(getNumber(left.saldo_neto) ?? 0)
    )
    .slice(0, 5)
    .map((row) => ({
      "Razón social": getString(row.razon_social) || "—",
      "Saldo sin anticipos": formatCurrency(row.facturas_pendientes),
      Anticipos: formatCurrency(
        isCreditor ? row.anticipos_pendientes : row.anticipos_recibidos
      ),
      "Saldo neto": formatCurrency(row.saldo_neto),
      "Días promedio": formatDays(row.dias_promedio)
    }));

  return (
    <div className="financial-report-counterparty-column" key={title}>
      <h3>{title}</h3>
      {agingSpec ? (
        <div className="financial-report-aging-bar-wrap">
          <PlotlyChart spec={withChartHeight(agingSpec, 90)} />
        </div>
      ) : (
        <p className="muted">Sin datos de vencimiento para mostrar.</p>
      )}
      <span className="financial-metric-value">{formatCurrency(total)}</span>
      <p className="muted financial-report-solvencia-note">
        {AGING_BUCKETS.map((bucket) => `${bucket.label}: ${formatCurrency(bucketTotals[bucket.key])}`).join(
          " | "
        )}
      </p>
      <details className="financial-report-table-accordion">
        <summary>
          <ReportChevron />
          Top 5
        </summary>
        {renderTable(top5, {
          columns: ["Razón social", "Saldo sin anticipos", "Anticipos", "Saldo neto", "Días promedio"],
          tableClassName: "financial-report-data-table",
          wrapClassName: "financial-report-table-wrap"
        })}
      </details>
    </div>
  );
}

function buildFlujoVariationSpec(rows: Array<Record<string, unknown>>, valueKey: string) {
  if (rows.length === 0) {
    return null;
  }

  const categoryOrder = rows.map((row) => getString(row.etiqueta));

  return {
    data: (["activo", "pasivo", "capital"] as const).map((bloque) => {
      const bloqueRows = rows.filter((row) => getString(row.bloque) === bloque);
      return {
        type: "bar",
        orientation: "h",
        name: FLUJO_BLOQUE_LABELS[bloque],
        x: bloqueRows.map((row) => getNumber(row[valueKey]) ?? 0),
        y: bloqueRows.map((row) => getString(row.etiqueta)),
        marker: { color: FLUJO_BLOQUE_COLORS[bloque] }
      };
    }),
    layout: {
      margin: { l: 160, r: 12, t: 12, b: 24 },
      legend: { orientation: "h" },
      yaxis: { categoryorder: "array", categoryarray: [...categoryOrder].reverse() }
    }
  };
}

function buildHorizontalBarSpec(
  rows: Array<Record<string, unknown>>,
  {
    labelKeyCandidates,
    valueKey,
    title
  }: {
    labelKeyCandidates: string[];
    valueKey: string;
    title: string;
  }
) {
  if (rows.length === 0) {
    return null;
  }

  const labelKey = labelKeyCandidates.find((key) => rows.some((row) => getString(row[key]).length > 0));
  if (!labelKey) {
    return null;
  }

  const orderedRows = [...rows].sort(
    (left, right) => (getNumber(left[valueKey]) ?? 0) - (getNumber(right[valueKey]) ?? 0)
  );

  return {
    data: [
      {
        type: "bar",
        orientation: "h",
        x: orderedRows.map((row) => getNumber(row[valueKey]) ?? 0),
        y: orderedRows.map((row) => getString(row[labelKey])),
        marker: { color: CHART_COLOR_SINGLE }
      }
    ],
    layout: {
      title,
      margin: { l: 24, r: 12, t: 36, b: 24 }
    }
  };
}

function buildProducedVsInvoicedSpec(rows: Array<Record<string, unknown>>, title: string) {
  if (rows.length === 0) {
    return null;
  }

  const producedPeriods = rows.map((row) => getString(row.periodo));
  const xValues = producedPeriods.map((period) => monthLabelDisambiguated(period, producedPeriods));
  return {
    data: [
      {
        type: "bar",
        name: "Producido",
        x: xValues,
        y: rows.map((row) => getNumber(row.producido_t ?? row.kg_producidos) ?? 0),
        marker: { color: CHART_COLOR_SERIES[0] }
      },
      {
        type: "bar",
        name: "Facturado",
        x: xValues,
        y: rows.map((row) => getNumber(row.facturado_t ?? row.kg_facturados) ?? 0),
        marker: { color: CHART_COLOR_SERIES[1] }
      }
    ],
    layout: {
      title,
      barmode: "group",
      margin: { l: 24, r: 12, t: 36, b: 24 }
    }
  };
}

function withChartHeight(spec: unknown, height: number) {
  if (!isRecord(spec)) {
    return spec;
  }

  const layout = isRecord(spec.layout) ? spec.layout : {};
  return { ...spec, layout: { ...layout, height } };
}

function renderTable(
  rows: Array<Record<string, unknown>>,
  {
    columns,
    formatters = {},
    getCellFormatter,
    getRowClassName,
    tableClassName,
    wrapClassName
  }: {
    columns: string[];
    formatters?: Record<string, (value: unknown) => string>;
    getCellFormatter?: (
      row: Record<string, unknown>,
      column: string
    ) => ((value: unknown) => string) | undefined;
    getRowClassName?: (row: Record<string, unknown>) => string | undefined;
    tableClassName?: string;
    wrapClassName?: string;
  }
) {
  if (rows.length === 0) {
    return <div className="financial-empty-state">No hay datos disponibles.</div>;
  }

  return (
    <div className={`financial-table-wrap${wrapClassName ? ` ${wrapClassName}` : ""}`}>
      <table className={`financial-table${tableClassName ? ` ${tableClassName}` : ""}`}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr className={getRowClassName?.(row)} key={`${index}-${columns[0]}`}>
              {columns.map((column) => {
                const cellFormatter =
                  getCellFormatter?.(row, column) ?? formatters[column];
                return (
                  <td key={column}>
                    {cellFormatter ? cellFormatter(row[column]) : formatTableValue(row[column])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function readErrorMessage(response: Response, fallback: string) {
  return response
    .json()
    .then((payload: { detail?: string }) => payload.detail ?? fallback)
    .catch(() => fallback);
}

function ReportAssistantPanel({
  dataSource,
  endPeriod,
  isMobile,
  isOpen,
  onClose,
  reportContext,
  reportLineage,
  sociedad,
  sociedadCode,
  startPeriod,
  viewMode
}: {
  dataSource: "gold" | "silver2" | null;
  endPeriod: string;
  isMobile: boolean;
  isOpen: boolean;
  onClose: () => void;
  reportContext: string;
  reportLineage: string;
  sociedad: string;
  sociedadCode: string;
  startPeriod: string;
  viewMode: string;
}) {
  const [messages, setMessages] = useState<ReportAssistantMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionId, setSessionId] = useState(createAssistantSessionId);
  const [modalState, setModalState] = useState<ReportAssistantModalState | null>(null);

  function resetChat() {
    setMessages([]);
    setQuestion("");
    setSessionId(createAssistantSessionId());
  }

  useEffect(() => {
    resetChat();
  }, [sociedad, startPeriod, endPeriod]);

  async function handleSubmit() {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isSubmitting) {
      return;
    }

    const userMessage: ReportAssistantMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmedQuestion
    };

    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/financialbi/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question: trimmedQuestion,
          report_context: reportContext,
          report_lineage: reportLineage,
          sociedad,
          sociedad_code: sociedadCode,
          start_period: startPeriod,
          end_period: endPeriod,
          view_mode: viewMode,
          data_source: dataSource ?? undefined,
          lang: "es",
          session_id: sessionId
        })
      });

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "No se pudo consultar el asistente del reporte.")
        );
      }

      const payload = (await response.json()) as FinancialbiAskResponse;
      const assistantMessage: ReportAssistantMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content:
          payload.error === "not_supported"
            ? "La consulta no esta soportada en este momento."
            : payload.answer?.trim() || "No se pudo generar una respuesta.",
        sqlQuery: payload.sql_query ?? null,
        records: payload.rows ?? null,
        meta: payload.error
          ? undefined
          : payload.used_exploration
            ? "Fuente: consulta a BigQuery (periodo según la pregunta — ver SQL)"
            : `Rango ${startPeriod} – ${endPeriod} · Fuente: datos del reporte en pantalla`
      };

      setMessages((current) => [...current, assistantMessage]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "No se pudo consultar el asistente del reporte."
        }
      ]);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div
        className={`financial-report-assistant${isOpen ? " is-open" : ""}${isMobile ? " is-mobile" : ""}`}
      >
        <div className="financial-report-assistant-header">
          <div>
            <h2>Asistente del reporte</h2>
            <div className="financial-report-assistant-subheader">
              <p>
                Pregunta sobre el contexto activo:
                {sociedad ? ` Sociedad ${sociedad},` : ""} periodo {startPeriod} a {endPeriod}.
              </p>
              <button
                className="financial-report-assistant-new-chat"
                onClick={resetChat}
                type="button"
              >
                + Nuevo chat
              </button>
            </div>
          </div>
          <button
            aria-label="Cerrar asistente"
            className="financial-report-assistant-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="financial-report-assistant-body">
          {messages.length === 0 ? (
            <div className="financial-report-assistant-empty">
              Haz una pregunta sobre el report financiero actual.
            </div>
          ) : null}

          {messages.map((message) => (
            <article
              className={`financial-report-message financial-report-message-${message.role}`}
              key={message.id}
            >
              <div className="financial-report-message-role">
                {message.role === "user" ? "Usuario" : "Asistente"}
              </div>
              <div className="financial-report-message-content">{message.content}</div>
              {message.role === "assistant" && message.meta ? (
                <div className="financial-report-message-meta">{message.meta}</div>
              ) : null}
              {message.role === "assistant" && (message.records?.length || message.sqlQuery) ? (
                <div className="chatbi-data-actions">
                  {message.records?.length ? (
                    <button
                      className="chatbi-data-btn"
                      onClick={() =>
                        setModalState({
                          type: "table",
                          records: message.records ?? [],
                          rowCount: message.records?.length ?? 0
                        })
                      }
                      type="button"
                    >
                      Abrir datos
                    </button>
                  ) : null}
                  {message.sqlQuery ? (
                    <button
                      className="chatbi-data-btn chatbi-data-btn-sql"
                      onClick={() =>
                        setModalState({
                          type: "sql",
                          sqlQuery: message.sqlQuery ?? ""
                        })
                      }
                      type="button"
                    >
                      Ver SQL
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <div className="financial-report-assistant-composer">
          <textarea
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="Pregunta sobre este reporte..."
            rows={4}
            value={question}
          />
          <button
            className="btn btn-primary"
            disabled={isSubmitting || question.trim().length === 0}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {isSubmitting ? "Enviando..." : "Enviar"}
          </button>
        </div>
      </div>

      {modalState?.type === "table" ? (
        <ChatbiDataModal
          onClose={() => setModalState(null)}
          records={modalState.records}
          rowCount={modalState.rowCount}
          type="table"
        />
      ) : null}
      {modalState?.type === "sql" ? (
        <ChatbiDataModal
          onClose={() => setModalState(null)}
          sqlQuery={modalState.sqlQuery}
          type="sql"
        />
      ) : null}
    </>
  );
}

function useMeasuredHeight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setHeight(entry.contentRect.height);
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, height] as const;
}

function ChartTile({
  onEnlarge,
  spec
}: {
  onEnlarge: () => void;
  spec: unknown;
}) {
  return (
    <div className="financial-report-chart-tile">
      <button
        aria-label="Ampliar gráfico"
        className="financial-report-chart-tile-expand"
        onClick={onEnlarge}
        type="button"
      >
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        </svg>
      </button>
      <PlotlyChart spec={withChartHeight(spec, 260)} />
    </div>
  );
}

export function ReportWorkspace({
  initialCatalog,
  initialData,
  initialError,
  initialFilters
}: ReportWorkspaceProps) {
  const [filters, setFilters] = useState(initialFilters);
  const [reportData, setReportData] = useState(initialData);
  const [error, setError] = useState(initialError);
  const [isLoading, setIsLoading] = useState(false);
  // Secciones ya cargadas para la combinación de filtros `key` (carga lazy por
  // pestaña). El SSR inicial trae solo la sección de la pestaña por defecto.
  const [loadedSections, setLoadedSections] = useState(() => ({
    key: filtersDataKey(initialFilters),
    sections: new Set<string>(
      initialData ? [SECTION_BY_VIEW_MODE[initialFilters.viewMode] ?? "pyg"] : []
    )
  }));
  // Con merge de secciones, una respuesta tardía de filtros viejos corrompería
  // los datos: solo se aplica la respuesta de la última petición lanzada.
  const requestSeqRef = useRef(0);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isAssistantMobile, setIsAssistantMobile] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<
    "sociedad" | "start" | "end" | "view" | "lineaNegocio" | "planta" | "familia" | "canal" | null
  >(null);
  const [enlargedChart, setEnlargedChart] = useState<{ title: string; spec: unknown } | null>(
    null
  );
  const [flujoComparison, setFlujoComparison] = useState<"var_mes_anterior" | "var_inicio_anio">(
    "var_mes_anterior"
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [prodChartsRef, prodChartsAreaHeight] = useMeasuredHeight<HTMLDivElement>();
  const prodChartPlotHeight =
    prodChartsAreaHeight > 0 ? Math.max(prodChartsAreaHeight - 86, 260) : 420;

  const periodOptions = useMemo(
    () => Array.from(new Set(initialCatalog.meses)).sort(),
    [initialCatalog.meses]
  );

  const startPeriod = filters.startPeriod;
  const endPeriod = filters.endPeriod;
  const summary = (reportData?.summary ?? null) as FinancialbiSummary | null;
  const invalidRange = startPeriod > endPeriod;
  // ¿La sección de la pestaña activa ya está cargada para los filtros actuales?
  // Si no (y hay fetch en vuelo), se muestra un placeholder en vez de vistas vacías.
  const activeSectionLoaded =
    loadedSections.key === filtersDataKey(filters) &&
    loadedSections.sections.has(SECTION_BY_VIEW_MODE[filters.viewMode] ?? "pyg");

  // Con el asistente abierto se precargan las secciones que falten: su
  // contexto cubre así TODAS las pestañas de los filtros actuales, no solo la
  // visible. Una sola petición con las secciones pendientes; el lru_cache del
  // backend abarata las repeticiones.
  useEffect(() => {
    if (!isAssistantOpen) {
      return;
    }
    const key = filtersDataKey(filters);
    if (loadedSections.key !== key) {
      return; // hay un cambio de filtros en vuelo; se reintenta al completarse
    }
    const missing = CLIENT_REPORT_SECTIONS.filter(
      (section) => !loadedSections.sections.has(section)
    );
    if (missing.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/financialbi/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sociedad: filters.sociedad,
            start_period: filters.startPeriod,
            end_period: filters.endPeriod,
            view_mode: filters.viewMode,
            linea_negocio: filters.lineaNegocio,
            planta: filters.planta,
            familia: filters.familia,
            canal: filters.canal,
            incluir_partes_relacionadas: filters.incluirPartesRelacionadas,
            sections: missing
          })
        });
        if (!response.ok || cancelled) {
          return;
        }
        const payload = (await response.json()) as FinancialbiReportResponse;
        if (cancelled) {
          return;
        }
        setReportData((prev) =>
          prev ? { ...prev, summary: { ...prev.summary, ...payload.summary } } : payload
        );
        setLoadedSections((prev) =>
          prev.key === key
            ? { key, sections: new Set([...prev.sections, ...missing]) }
            : prev
        );
      } catch {
        // Prefetch silencioso: si falla, el asistente sigue funcionando con lo
        // cargado y el fallback SQL cubre el resto.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAssistantOpen, filters, loadedSections]);
  const reportContext = useMemo(() => serializeReportSummary(summary), [summary]);
  const reportLineage = useMemo(() => buildReportLineage(), []);
  // Set by the backend when the currently loaded report range came fully from
  // the materialized gold layer vs. a live silver2 recompute (financialbi
  // apps/financialbi/financialbi/app.py:_cached_report_payload). Used to let
  // the report assistant prioritize gold instead of always recomputing.
  const dataSource = (reportData?.data_source as "gold" | "silver2" | undefined) ?? null;

  useEffect(() => {
    if (!REPORT_ASSISTANT_ENABLED || typeof window === "undefined") {
      return;
    }

    const syncViewport = () => {
      setIsAssistantMobile(window.innerWidth <= 1180);
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const shouldLockShellScroll =
      REPORT_ASSISTANT_ENABLED && isAssistantOpen && !isAssistantMobile;

    document.body.classList.toggle(
      "nutrex-report-assistant-open",
      shouldLockShellScroll
    );

    return () => {
      document.body.classList.remove("nutrex-report-assistant-open");
    };
  }, [isAssistantMobile, isAssistantOpen]);

  useEffect(() => {
    if (!openDropdown || typeof document === "undefined") {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-report-dropdown="true"]')) {
        setOpenDropdown(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openDropdown]);

  useEffect(() => {
    if (!enlargedChart || typeof window === "undefined") {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setEnlargedChart(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enlargedChart]);

  async function loadReport(nextFilters: ReportFilters, opts?: { force?: boolean }) {
    setOpenDropdown(null);
    setFilters(nextFilters);

    if (nextFilters.startPeriod > nextFilters.endPeriod) {
      setError("El periodo de inicio no puede ser posterior al periodo de cierre.");
      return;
    }

    const section = SECTION_BY_VIEW_MODE[nextFilters.viewMode] ?? "pyg";
    const key = filtersDataKey(nextFilters);
    // Sección ya cargada con estos mismos filtros → cambio de pestaña
    // instantáneo, sin petición (cubre también pg ↔ eur_ton).
    if (!opts?.force && key === loadedSections.key && loadedSections.sections.has(section)) {
      return;
    }

    const seq = ++requestSeqRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/financialbi/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sociedad: nextFilters.sociedad,
          start_period: nextFilters.startPeriod,
          end_period: nextFilters.endPeriod,
          view_mode: nextFilters.viewMode,
          linea_negocio: nextFilters.lineaNegocio,
          planta: nextFilters.planta,
          familia: nextFilters.familia,
          canal: nextFilters.canal,
          incluir_partes_relacionadas: nextFilters.incluirPartesRelacionadas,
          sections: [section]
        })
      });

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "No se pudo cargar el reporte financiero.")
        );
      }

      const payload = (await response.json()) as FinancialbiReportResponse;
      if (seq !== requestSeqRef.current) {
        return; // respuesta obsoleta: hubo otra petición posterior
      }
      if (key === loadedSections.key) {
        // Mismos filtros: se mergea la sección nueva sobre lo ya cargado. El
        // backend OMITE las claves de secciones no pedidas, así el spread no
        // machaca secciones previas.
        setReportData((prev) =>
          prev
            ? { ...prev, ...payload, summary: { ...prev.summary, ...payload.summary } }
            : payload
        );
        setLoadedSections((prev) => ({
          key,
          sections: new Set(prev.sections).add(section)
        }));
      } else {
        // Cambiaron los filtros: los datos de otras secciones ya no valen.
        setReportData(payload);
        setLoadedSections({ key, sections: new Set([section]) });
      }
    } catch (loadError) {
      if (seq === requestSeqRef.current) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "No se pudo cargar el reporte financiero."
        );
      }
    } finally {
      if (seq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }

  function updateFilter<Key extends keyof ReportFilters>(key: Key, value: ReportFilters[Key]) {
    setFilters((current) => ({
      ...current,
      [key]: value
    }));
  }

  const salesKpis = summary?.sales_kpis ?? {};
  const prodKpis = summary?.prod_kpis ?? {};
  const margenKpis = summary?.margen_kpis ?? {};
  const margenByFamilyRows = dataframeToRows(summary?.margen_by_family);
  const margenByProductRows = dataframeToRows(summary?.margen_by_product);
  const margenByCanalRows = dataframeToRows(summary?.margen_by_canal);
  const margenTrendRows = dataframeToRows(summary?.margen_trend);
  const pygRows = dataframeToRows(filters.viewMode === "eur_ton" ? summary?.pyg_eur_ton : summary?.pyg_range);
  const monthColumns = Array.isArray(summary?.pyg_month_cols) ? summary.pyg_month_cols : [];
  const revenueTrendRows = dataframeToRows(summary?.revenue_trend);
  const familyVolumeRows = dataframeToRows(summary?.vol_by_family_month);
  const categoryVolumeRows = dataframeToRows(summary?.vol_by_categoria_month);
  const revenueByFamilyRows = dataframeToRows(summary?.sales_revenue_by_family);
  const topProductsRows = dataframeToRows(summary?.top_products_month);
  const producedVsInvoicedRows = dataframeToRows(summary?.prod_vs_fact_month);
  const clientsByMonthRows = dataframeToRows(summary?.clients_by_month);
  const topProductionRows = dataframeToRows(summary?.top_production_by_month);
  const prodByFamilyRows = dataframeToRows(summary?.prod_by_family_month);
  const solvenciaRows: Array<Record<string, unknown>> = dataframeToRows(summary?.solvencia).map(
    (row) => ({
      ...row,
      periodo: `${row.anio}-${String(row.mes).padStart(2, "0")}`
    })
  );
  const flujoRows: Array<Record<string, unknown>> = dataframeToRows(summary?.flujo)
    .sort((left, right) => {
      const leftKey = (getNumber(left.anio) ?? 0) * 10000 + (getNumber(left.mes) ?? 0) * 100 + (getNumber(left.orden) ?? 0);
      const rightKey = (getNumber(right.anio) ?? 0) * 10000 + (getNumber(right.mes) ?? 0) * 100 + (getNumber(right.orden) ?? 0);
      return leftKey - rightKey;
    })
    .map((row) => ({
      ...row,
      periodo: `${row.anio}-${String(row.mes).padStart(2, "0")}`
    }));
  const salesByRegionRows = dataframeToRows(summary?.sales_by_region);
  const regionFamilyMatrixRows = dataframeToRows(summary?.region_family_matrix);
  const acreedoresRows = dataframeToRows(summary?.acreedores);
  const deudoresRows = dataframeToRows(summary?.deudores);
  const acreedoresTrendRows: Array<Record<string, unknown>> = dataframeToRows(
    summary?.acreedores_trend
  )
    .sort((left, right) => {
      const leftKey = (getNumber(left.anio) ?? 0) * 100 + (getNumber(left.mes) ?? 0);
      const rightKey = (getNumber(right.anio) ?? 0) * 100 + (getNumber(right.mes) ?? 0);
      return leftKey - rightKey;
    })
    .map((row) => ({ ...row, periodo: `${row.anio}-${String(row.mes).padStart(2, "0")}` }));
  const deudoresTrendRows: Array<Record<string, unknown>> = dataframeToRows(summary?.deudores_trend)
    .sort((left, right) => {
      const leftKey = (getNumber(left.anio) ?? 0) * 100 + (getNumber(left.mes) ?? 0);
      const rightKey = (getNumber(right.anio) ?? 0) * 100 + (getNumber(right.mes) ?? 0);
      return leftKey - rightKey;
    })
    .map((row) => ({ ...row, periodo: `${row.anio}-${String(row.mes).padStart(2, "0")}` }));

  const moneyFormatter = filters.viewMode === "eur_ton" ? formatCurrencyPerTon : formatCurrency;

  // Maka (BigQuery) y Nutrex (Azure SQL) usan nombres de subtotal distintos en
  // el mismo P&G — ver apps/financialbi/financialbi/report_engine.py
  // (_pyg_rows_maka vs _pyg_rows_nutrex). Replica el fallback de
  // frontend_report.py::_render_pyg_kpis para que ambos clientes muestren KPIs.
  const getPygYtd = (concepto: string): number | null =>
    getNumber(pygRows.find((row) => getString(row.concepto) === concepto)?.YTD);

  const pygIngresos =
    getPygYtd("Total Ventas Netas") ??
    getPygYtd("Ingresos Netos Totales") ??
    getPygYtd("Total Ingresos");
  const pygMargen = getPygYtd("Utilidad Bruta") ?? getPygYtd("Margen Bruto");
  const pygMargenPct = getPygYtd("Utilidad Bruta %") ?? getPygYtd("Margen Bruto %");
  const pygUtilOp = getPygYtd("EBITDA") ?? getPygYtd("Mg. Contribución I");
  const pygEbitda = getPygYtd("EBITDA");
  const pygEbitdaPct = getPygYtd("EBITDA %/Ventas") ?? getPygYtd("EBITDA %");
  const pygIsMaka = getPygYtd("Utilidad Bruta") !== null;
  const pygMargenLabel = pygIsMaka ? "Utilidad Bruta YTD" : "Margen Bruto YTD";
  const pygUtilOpLabel = pygIsMaka ? "EBITDA YTD" : "Mg. Contrib. I YTD";
  const pygEbitdaPctLabel = pygIsMaka ? "EBITDA % s/Ventas" : "Mg. Contrib. I %";

  const viewKpis: Array<{ label: string; value: string; delta?: string }> =
    filters.viewMode === "pg" || filters.viewMode === "eur_ton"
      ? [
          { label: "Ingresos YTD", value: moneyFormatter(pygIngresos) },
          {
            label: pygMargenLabel,
            value: moneyFormatter(pygMargen),
            delta: formatPercentDelta(pygMargenPct)
          },
          { label: pygUtilOpLabel, value: moneyFormatter(pygUtilOp) },
          {
            label: pygEbitdaPctLabel,
            value: moneyFormatter(pygEbitda),
            delta: formatPercentDelta(pygEbitdaPct)
          }
        ]
      : filters.viewMode === "solvencia" || filters.viewMode === "flujo"
        ? [] // Solvencia y Flujo tienen sus propias bandas de métricas en el cuerpo de la página.
        : filters.viewMode === "sales"
          ? [
              { label: "Ingresos del periodo", value: formatCurrency(salesKpis.ingresos) },
              { label: "Toneladas facturadas", value: formatTons(salesKpis.toneladas) },
              { label: "Clientes activos", value: String(salesKpis.clientes ?? "—") },
              // Margen directo: solo si hay líneas con receta costeada en el rango.
              ...(margenKpis.margen !== null && margenKpis.margen !== undefined
                ? [
                    { label: "Margen directo del periodo", value: formatCurrency(margenKpis.margen) },
                    {
                      label: "Margen % (s/ ventas costeadas)",
                      value: formatRatioPercent(margenKpis.margen_pct)
                    },
                    {
                      label: "Ventas con coste calculado",
                      value: formatRatioPercent(margenKpis.cobertura_pct)
                    }
                  ]
                : [])
            ]
          : filters.viewMode === "prod"
            ? [
                { label: "Toneladas producidas", value: formatTons(prodKpis.toneladas_producidas) },
                { label: "Toneladas facturadas", value: formatTons(prodKpis.toneladas_facturadas) },
                { label: "Productos producidos", value: String(prodKpis.productos ?? "—") }
              ]
            : []; // cualquier vista futura sin KPIs propios en la barra compartida.

  function renderPygView() {
    if (pygRows.length === 0) {
      return <div className="financial-empty-state">No hay datos disponibles.</div>;
    }

    type DisplayRow =
      | { kind: "group-header"; groupKey: string; displayName: string; data: Record<string, unknown> }
      | { kind: "child"; groupKey: string; data: Record<string, unknown> }
      | { kind: "normal"; data: Record<string, unknown> };

    const childToGroupKey = new Map<string, string>();
    const headerConceptToGroupKey = new Map<string, string>();
    for (const group of PYG_GROUPS) {
      for (const child of group.children) {
        childToGroupKey.set(child, group.key);
      }
      if (group.headerConcept) {
        headerConceptToGroupKey.set(group.headerConcept, group.key);
      }
    }

    const allCols = ["concepto", ...monthColumns.filter((c) => c !== "YTD"), "YTD"].filter(
      (col) => pygRows.some((r) => col in r)
    );
    const dataCols = allCols.filter((col) => col !== "concepto");

    // Pre-scan: collect the data rows that act as group headers (come after children in data)
    const headerRowByGroupKey = new Map<string, Record<string, unknown>>();
    for (const row of pygRows) {
      const gk = headerConceptToGroupKey.get(getString(row.concepto));
      if (gk) headerRowByGroupKey.set(gk, row);
    }

    // Gastos: synthetic header computed from its children
    const gastosGroup = PYG_GROUPS.find((g) => g.key === "gastos")!;
    const gastosChildren = pygRows.filter((r) => gastosGroup.children.has(getString(r.concepto)));
    if (gastosChildren.length > 0) {
      const synthetic: Record<string, unknown> = { concepto: gastosGroup.displayName, tipo: "subtotal" };
      for (const col of dataCols) {
        synthetic[col] = gastosChildren.reduce((sum, r) => sum + (getNumber(r[col]) ?? 0), 0);
      }
      headerRowByGroupKey.set("gastos", synthetic);
    }

    const displayRows: DisplayRow[] = [];
    const groupHeaderInserted = new Set<string>();

    for (const row of pygRows) {
      const concepto = getString(row.concepto);
      const groupKey = childToGroupKey.get(concepto);

      // Skip the original subtotal row — it already renders as the group header at the top
      if (headerConceptToGroupKey.has(concepto)) continue;

      // Before the first child of a group, insert the group header
      if (groupKey && !groupHeaderInserted.has(groupKey)) {
        groupHeaderInserted.add(groupKey);
        const group = PYG_GROUPS.find((g) => g.key === groupKey)!;
        const headerData = headerRowByGroupKey.get(groupKey);
        if (headerData) {
          displayRows.push({ kind: "group-header", groupKey, displayName: group.displayName, data: headerData });
        }
      }

      if (groupKey) {
        displayRows.push({ kind: "child", groupKey, data: row });
      } else {
        displayRows.push({ kind: "normal", data: row });
      }
    }

    function toggleGroup(key: string) {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }

    function formatCell(row: Record<string, unknown>, col: string) {
      if (col === "concepto") return getString(row.concepto) || "—";
      if (getString(row.tipo) === "porcentaje") return formatRatioPercent(row[col]);
      return moneyFormatter(row[col]);
    }

    function normalRowClass(data: Record<string, unknown>) {
      const tipo = getString(data.tipo);
      if (tipo === "subtotal") return "financial-report-pyg-row financial-report-pyg-row-subtotal";
      if (tipo === "porcentaje") return "financial-report-pyg-row financial-report-pyg-row-porcentaje";
      return "financial-report-pyg-row";
    }

    return (
      <div className="financial-table-wrap financial-report-table-wrap">
        <table className="financial-table financial-report-pyg-table financial-report-data-table">
          <thead>
            <tr>
              {allCols.map((col) => (
                <th key={col}>{col === "YTD" ? "Acumulado" : col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((dr, i) => {
              if (dr.kind === "group-header") {
                const expanded = expandedGroups.has(dr.groupKey);
                return (
                  <tr key={`gh-${i}`} className="financial-report-pyg-row financial-report-pyg-row-group">
                    <td>
                      <button
                        className="financial-report-pyg-group-toggle"
                        onClick={() => toggleGroup(dr.groupKey)}
                        type="button"
                      >
                        {expanded ? "−" : "+"}
                      </button>
                      {dr.displayName}
                    </td>
                    {dataCols.map((col) => (
                      <td key={col}>{moneyFormatter(dr.data[col])}</td>
                    ))}
                  </tr>
                );
              }

              if (dr.kind === "child") {
                if (!expandedGroups.has(dr.groupKey)) return null;
                return (
                  <tr key={`ch-${i}`} className="financial-report-pyg-row financial-report-pyg-row-child">
                    {allCols.map((col) => (
                      <td key={col}>{formatCell(dr.data, col)}</td>
                    ))}
                  </tr>
                );
              }

              return (
                <tr key={`nr-${i}`} className={normalRowClass(dr.data)}>
                  {allCols.map((col) => (
                    <td key={col}>{formatCell(dr.data, col)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function renderSolvenciaView() {
    if (solvenciaRows.length === 0) {
      return (
        <div className="financial-empty-state">
          No hay datos de balance para el período seleccionado.
        </div>
      );
    }

    const last = solvenciaRows[solvenciaRows.length - 1];
    const closeLabel = formatPeriodLongLabel(getString(last.periodo));

    const liquidezSpec = buildMultiSeriesLineSpec(solvenciaRows, [
      { key: "liquidez_circulante", name: "Liquidez", color: CHART_COLOR_SERIES[0] },
      { key: "razon_rapida", name: "Razón rápida", color: CHART_COLOR_SERIES[1] },
      { key: "solvencia", name: "Solvencia", color: CHART_COLOR_SERIES[2] }
    ]);
    const rentabilidadSpec = buildMultiSeriesLineSpec(solvenciaRows, [
      { key: "ros", name: "ROS", color: CHART_COLOR_SERIES[0] },
      { key: "roa", name: "ROA", color: CHART_COLOR_SERIES[1] },
      { key: "roe", name: "ROE", color: CHART_COLOR_SERIES[2] }
    ]);

    return (
      <div className="financial-report-view-solvencia">
        <section className="financial-panel">
          <p className="muted">
            <strong>Balance a cierre de {closeLabel}</strong> — no cambia si amplías el rango de
            fechas, solo si cambias el mes de Cierre.
            <InfoTooltip items={[
              "Liquidez y razón rápida: >1 indica que el activo circulante cubre el pasivo de corto plazo.",
              "Solvencia: proporción del activo financiada con deuda."
            ]} />
          </p>
          <div className="financial-kpi-band">
            <div className="financial-kpi-band-item">
              <span className="financial-kpi-band-label">Liquidez del circulante</span>
              <span className="financial-kpi-band-value">{formatRatio(last.liquidez_circulante)}</span>
            </div>
            <div className="financial-kpi-band-item">
              <span className="financial-kpi-band-label">Razón rápida</span>
              <span className="financial-kpi-band-value">{formatRatio(last.razon_rapida)}</span>
            </div>
            <div className="financial-kpi-band-item">
              <span className="financial-kpi-band-label">Solvencia (Pasivo/Activo)</span>
              <span className="financial-kpi-band-value">{formatRatio(last.solvencia)}</span>
            </div>
            <div className="financial-kpi-band-item">
              <span className="financial-kpi-band-label">Deuda total</span>
              <span className="financial-kpi-band-value">{formatCurrency(last.deuda_total)}</span>
            </div>
          </div>
        </section>

        <section className="financial-panel">
          <p className="muted">
            <strong>Rentabilidad acumulada — enero a {closeLabel} (YTD)</strong>
            <InfoTooltip items={[
              "Ratios acumulados del año (enero a la fecha), no del mes suelto.",
              "Deuda/EBITDA sale N/A cuando el EBITDA acumulado no es positivo."
            ]} />
          </p>
          <div className="financial-kpi-band">
            <div className="financial-kpi-band-item">
              <span className="financial-kpi-band-label">ROS (Utilidad Op./Ventas)</span>
              <span className="financial-kpi-band-value">{formatRatioPercent(last.ros)}</span>
            </div>
            <div className="financial-kpi-band-item">
              <span className="financial-kpi-band-label">ROA (Utilidad Op./Activo)</span>
              <span className="financial-kpi-band-value">{formatRatioPercent(last.roa)}</span>
            </div>
            <div className="financial-kpi-band-item">
              <span className="financial-kpi-band-label">ROE (Utilidad Op./Capital)</span>
              <span className="financial-kpi-band-value">{formatRatioPercent(last.roe)}</span>
            </div>
            <div className="financial-kpi-band-item">
              <span className="financial-kpi-band-label">Rotación de CxC</span>
              <span className="financial-kpi-band-value">{formatRatio(last.rotacion_cxc)}</span>
            </div>
            <div className="financial-kpi-band-item">
              <span className="financial-kpi-band-label">Deuda / EBITDA</span>
              <span className="financial-kpi-band-value">{formatDeudaEbitda(last.deuda_ebitda)}</span>
            </div>
          </div>
        </section>

        <section className="financial-panel">
          <p className="muted">
            <strong>Balance total a cierre de {closeLabel}</strong>
          </p>
          <div className="financial-kpi-band">
            <div className="financial-kpi-band-item">
              <span className="financial-kpi-band-label">Activo total</span>
              <span className="financial-kpi-band-value">{formatCurrency(last.activo_total)}</span>
            </div>
            <div className="financial-kpi-band-item">
              <span className="financial-kpi-band-label">Pasivo total</span>
              <span className="financial-kpi-band-value">{formatCurrency(last.pasivo_total)}</span>
            </div>
            <div className="financial-kpi-band-item">
              <span className="financial-kpi-band-label">Capital contable</span>
              <span className="financial-kpi-band-value">
                {formatCurrency(last.capital_contable)}
              </span>
            </div>
          </div>
        </section>

        <div className="financial-grid-two">
          {liquidezSpec ? (
            <section className="financial-panel financial-chart-card">
              <h3>Evolución de razones financieras</h3>
              <PlotlyChart spec={withChartHeight(liquidezSpec, 300)} />
            </section>
          ) : null}
          {rentabilidadSpec ? (
            <section className="financial-panel financial-chart-card">
              <h3>Evolución de rentabilidad (acumulado del año)</h3>
              <PlotlyChart spec={withChartHeight(rentabilidadSpec, 300)} />
            </section>
          ) : null}
        </div>

        <details className="financial-report-table-accordion" open>
          <summary>
            <ReportChevron />
            Balance y ratios por mes
          </summary>
          {renderTable(solvenciaRows, {
            columns: [
              "periodo",
              "activo_total",
              "pasivo_total",
              "capital_contable",
              "resultado_ejercicio",
              "liquidez_circulante",
              "razon_rapida",
              "solvencia",
              "ros",
              "roa",
              "roe",
              "rotacion_cxc",
              "deuda_ebitda"
            ],
            formatters: {
              periodo: (value) =>
                monthLabelDisambiguated(
                  getString(value),
                  solvenciaRows.map((row) => getString(row.periodo))
                ),
              activo_total: formatCurrency,
              pasivo_total: formatCurrency,
              capital_contable: formatCurrency,
              resultado_ejercicio: formatCurrency,
              liquidez_circulante: formatRatio,
              razon_rapida: formatRatio,
              solvencia: formatRatio,
              ros: formatRatioPercent,
              roa: formatRatioPercent,
              roe: formatRatioPercent,
              rotacion_cxc: formatRatio,
              deuda_ebitda: formatDeudaEbitda
            },
            tableClassName: "financial-report-data-table",
            wrapClassName: "financial-report-table-wrap"
          })}
        </details>
        <p className="muted financial-report-solvencia-note">
          Ratios de rentabilidad (ROS, ROA, ROE, rotación de CxC, Deuda/EBITDA): acumulado del año
          (YTD), propuesto pendiente de validar con el contable. Fuente: MAKA_SOLVENCIA
          (BigQuery).
        </p>
      </div>
    );
  }

  function renderFlujoView() {
    if (flujoRows.length === 0) {
      return (
        <div className="financial-empty-state">
          No hay datos de balance para el período seleccionado.
        </div>
      );
    }

    const last = flujoRows[flujoRows.length - 1];
    const lastAnio = getNumber(last.anio);
    const lastMes = getNumber(last.mes);
    const closeLabel = formatPeriodLongLabel(getString(last.periodo));
    const varCol = flujoComparison;
    const comparisonLabel =
      varCol === "var_mes_anterior" ? "mes anterior" : "inicio de año";

    const cierre = flujoRows.filter(
      (row) => getNumber(row.anio) === lastAnio && getNumber(row.mes) === lastMes
    );

    function flujoKpi(partida: string, labelOverride?: string) {
      const row = cierre.find((candidate) => getString(candidate.partida) === partida);
      const delta = row ? formatFlujoVar(row[varCol]) : undefined;
      return (
        <div className="financial-kpi-band-item" key={partida}>
          <span className="financial-kpi-band-label">
            {labelOverride ?? (row ? getString(row.etiqueta) : partida)}
          </span>
          <span className="financial-kpi-band-value">
            {row ? formatCurrency(row.saldo_fin_mes) : "—"}
          </span>
          {delta ? (
            <span
              className={`financial-report-view-kpi-delta${
                delta.startsWith("-") ? " is-negative" : " is-positive"
              }`}
            >
              {delta}
            </span>
          ) : null}
        </div>
      );
    }

    const detalle = cierre.filter((row) => !row.es_total);
    const variationSpec = buildFlujoVariationSpec(detalle, varCol);

    const monthPeriods = Array.from(new Set(flujoRows.map((row) => getString(row.periodo))));
    // Etiqueta desambiguada (incluye año si el rango cruza de año) -- si no,
    // dos meses de años distintos con el mismo nombre ("Ene" de 2025 y de
    // 2026) generarían la misma clave `record[...]` y el segundo pisaría al
    // primero en la tabla pivote.
    const monthColLabels = monthPeriods.map((period) => monthLabelDisambiguated(period, monthPeriods));
    const saldoColumn = `Saldo ${closeLabel}`;
    const pivotRows: Array<Record<string, unknown>> = cierre.map((closeRow) => {
      const partida = getString(closeRow.partida);
      const record: Record<string, unknown> = {
        Partida: getString(closeRow.etiqueta) || partida
      };
      monthPeriods.forEach((period, index) => {
        const monthRow = flujoRows.find(
          (row) => getString(row.partida) === partida && getString(row.periodo) === period
        );
        record[monthColLabels[index]] = formatFlujoVar(monthRow?.[varCol]);
      });
      record[saldoColumn] = formatCurrency(closeRow.saldo_fin_mes);
      return record;
    });

    return (
      <div className="financial-report-view-solvencia">
        <section className="financial-panel">
          <div className="financial-tab-strip">
            <button
              className={`financial-tab-button${
                flujoComparison === "var_mes_anterior" ? " is-active" : ""
              }`}
              onClick={() => setFlujoComparison("var_mes_anterior")}
              type="button"
            >
              Mes anterior
            </button>
            <button
              className={`financial-tab-button${
                flujoComparison === "var_inicio_anio" ? " is-active" : ""
              }`}
              onClick={() => setFlujoComparison("var_inicio_anio")}
              type="button"
            >
              Inicio de año
            </button>
          </div>

          <div className="financial-kpi-band financial-report-flujo-kpis financial-report-flujo-kpis-partidas">
            {flujoKpi("cxp")}
            {flujoKpi("bancos")}
            {flujoKpi("inventarios")}
            {flujoKpi("cxc")}
            {flujoKpi("anticipos")}
            {flujoKpi("iva_favor")}
          </div>
          <p className="muted financial-report-solvencia-note">
            Saldo a cierre de {closeLabel} y su variación ({comparisonLabel}). El color solo
            indica si la partida sube o baja, sin juicio de bueno/malo (en Cuentas por Pagar,
            subir = debemos más).
          </p>
        </section>

        <section className="financial-panel">
          <p className="muted">
            <strong>Totales a cierre de {closeLabel}</strong>
          </p>
          <div className="financial-kpi-band financial-report-flujo-kpis">
            {flujoKpi("total_activo", "TOTAL ACTIVO")}
            {flujoKpi("total_pasivo", "TOTAL PASIVO")}
            {flujoKpi("total_capital", "TOTAL CAPITAL (incl. resultado)")}
            {flujoKpi("resultado_ejercicio", "Utilidad/Pérdida del ejercicio")}
          </div>
          <p className="muted financial-report-solvencia-note">
            El flujo cuadra: ΔActivo = ΔPasivo + ΔCapital (el resultado del ejercicio forma parte
            del capital; su variación mensual es el resultado del mes).
          </p>
        </section>

        {variationSpec ? (
          <section className="financial-panel financial-chart-card">
            <h3>Variación por partida — {closeLabel} ({comparisonLabel})</h3>
            <PlotlyChart spec={withChartHeight(variationSpec, 420)} />
          </section>
        ) : null}

        <details className="financial-report-table-accordion" open>
          <summary>
            <ReportChevron />
            Variaciones por mes
          </summary>
          {renderTable(pivotRows, {
            columns: ["Partida", ...monthColLabels, saldoColumn],
            tableClassName: "financial-report-data-table",
            wrapClassName: "financial-report-table-wrap"
          })}
        </details>
        <p className="muted financial-report-solvencia-note">
          Variaciones calculadas en BigQuery (MAKA_FLUJO_RECURSOS) sobre los saldos del
          Mayor de SAP; los saldos por grupo están contrastados con el balance del contable
          (exactos al céntimo). Agrupación de cuentas pendiente de validar con el contable.
          Depreciación acumulada es contra-activo: su variación negativa es la depreciación del
          periodo.
        </p>
      </div>
    );
  }

  function renderClientsGeoView() {
    const regionSpec = buildHorizontalBarSpec(salesByRegionRows, {
      labelKeyCandidates: ["region"],
      valueKey: "ingresos",
      title: "Ventas por Región"
    });

    const matrixColumns =
      regionFamilyMatrixRows.length > 0 ? Object.keys(regionFamilyMatrixRows[0]) : [];
    const matrixFormatters = Object.fromEntries(
      matrixColumns
        .filter((column) => column !== "region")
        .map((column) => [column, formatCurrency])
    );

    const fechaFotoCaption = buildFechaFotoCaption(
      acreedoresRows,
      deudoresRows,
      filters.endPeriod
    );
    const counterpartyTrendSpec = buildCounterpartyTrendSpec(
      acreedoresTrendRows,
      deudoresTrendRows,
      "Evolución de saldos"
    );
    const acreedoresAgingTrendSpec = buildAgingTrendSpec(acreedoresTrendRows, "Antigüedad de Acreedores");
    const deudoresAgingTrendSpec = buildAgingTrendSpec(deudoresTrendRows, "Antigüedad de Deudores");

    const counterpartyCharts = [
      { key: "counterpartyTrend", title: "Evolución de saldos", spec: counterpartyTrendSpec },
      { key: "acreedoresAging", title: "Antigüedad de Acreedores", spec: acreedoresAgingTrendSpec },
      { key: "deudoresAging", title: "Antigüedad de Deudores", spec: deudoresAgingTrendSpec }
    ];

    return (
      <div className="financial-report-view-solvencia">
        <p className="muted">
          Ventas de mercado — excluye la facturación intercompañía del canal &quot;06 -
          Partes Relacionadas&quot; (PAN ↔ MPE).
        </p>

        <div className="financial-grid-two financial-report-region-row">
          <div className="financial-report-region-chart">
            {regionSpec ? (
              <PlotlyChart
                spec={withChartHeight(
                  regionSpec,
                  Math.max(160, 12 * salesByRegionRows.length + 30)
                )}
              />
            ) : (
              <p className="muted">Sin datos de región en el rango seleccionado.</p>
            )}
          </div>

          <div className="financial-report-stacked-accordions">
            {salesByRegionRows.length > 0 ? (
              <details className="financial-report-table-accordion">
                <summary>
                  <ReportChevron />
                  Ventas por Región — detalle
                </summary>
                {renderTable(
                  salesByRegionRows.map((row) => ({
                    Región: getString(row.region),
                    Ingresos: formatCurrency(row.ingresos),
                    Toneladas: formatTons(row.toneladas)
                  })),
                  {
                    columns: ["Región", "Ingresos", "Toneladas"],
                    tableClassName: "financial-report-data-table",
                    wrapClassName: "financial-report-table-wrap"
                  }
                )}
              </details>
            ) : null}

            {regionFamilyMatrixRows.length > 0 ? (
              <details className="financial-report-table-accordion">
                <summary>
                  <ReportChevron />
                  Matriz Región × Familia
                </summary>
                {renderTable(regionFamilyMatrixRows, {
                  columns: matrixColumns,
                  formatters: matrixFormatters,
                  tableClassName: "financial-report-data-table",
                  wrapClassName: "financial-report-table-wrap"
                })}
              </details>
            ) : null}
          </div>
        </div>

        <section className="financial-panel">
          <h3>Acreedores y Deudores</h3>
          <p className="muted financial-report-solvencia-note">{fechaFotoCaption}</p>

          <div className="financial-grid-two">
            {renderCounterpartyColumn(
              "Acreedores (lo que debemos a proveedores)",
              acreedoresRows,
              true
            )}
            {renderCounterpartyColumn("Deudores (lo que nos deben clientes)", deudoresRows, false)}
          </div>

          {counterpartyCharts.some((chart) => chart.spec) ? (
            <>
              <h4 className="financial-report-subheading">Evolución de Acreedores y Deudores</h4>
              <div className="financial-report-charts-grid">
                {counterpartyCharts.map((chart) =>
                  chart.spec ? (
                    <ChartTile
                      key={chart.key}
                      onEnlarge={() => setEnlargedChart({ title: chart.title, spec: chart.spec })}
                      spec={chart.spec}
                    />
                  ) : null
                )}
              </div>
            </>
          ) : null}
        </section>
      </div>
    );
  }

  function renderSalesView() {
    const revenueTrendSpec = buildRevenueTrendSpec(
      revenueTrendRows,
      "Evolución de ingresos"
    );
    const familyVolumeSpec = buildMultiSeriesBarSpec(familyVolumeRows, {
      groupKeyCandidates: ["grupo", "familia"],
      title: "Volumen por familia",
      barmode: "stack"
    });
    const categoryVolumeSpec = buildMultiSeriesBarSpec(categoryVolumeRows, {
      groupKeyCandidates: ["grupo", "categoria", "categoria_articulo"],
      title: "Volumen por categoría",
      barmode: "group"
    });
    const revenueByFamilySpec = buildHorizontalBarSpec(revenueByFamilyRows, {
      labelKeyCandidates: ["familia"],
      valueKey: "ingresos",
      title: "Ventas por familia"
    });
    const topProductsSpec = buildMultiSeriesBarSpec(topProductsRows, {
      groupKeyCandidates: ["grupo", "producto"],
      title: "Top productos por mes",
      barmode: "group"
    });
    const producedVsInvoicedSpec = buildProducedVsInvoicedSpec(
      producedVsInvoicedRows,
      "Producción vs facturación"
    );

    const salesCharts = [
      { key: "revenueTrend", title: "Evolución de ingresos", spec: revenueTrendSpec },
      { key: "salesByFamily", title: "Ventas por familia", spec: revenueByFamilySpec },
      { key: "volByFamily", title: "Volumen por familia", spec: familyVolumeSpec },
      { key: "volByCategory", title: "Volumen por categoría", spec: categoryVolumeSpec },
      { key: "topProducts", title: "Top productos por mes", spec: topProductsSpec },
      { key: "prodVsFact", title: "Producción vs facturación", spec: producedVsInvoicedSpec }
    ];

    const margenByFamilySpec = buildHorizontalBarSpec(margenByFamilyRows, {
      labelKeyCandidates: ["familia"],
      valueKey: "margen",
      title: "Margen directo por familia"
    });
    const hasMargenByFamily = margenByFamilyRows.some((row) => getNumber(row.margen) !== null);
    const hasMargenTrend = margenTrendRows.some((row) => getNumber(row.margen) !== null);
    const margenBarTrendSpec = buildMargenBarTrendSpec(margenTrendRows, "Evolución del margen");
    const margenPctTrendSpec = buildMargenPctTrendSpec(margenTrendRows, "Evolución del margen %");

    return (
      <>
        <div className="financial-report-charts-grid">
          {salesCharts.map((chart) =>
            chart.spec ? (
              <ChartTile
                key={chart.key}
                onEnlarge={() => setEnlargedChart({ title: chart.title, spec: chart.spec })}
                spec={chart.spec}
              />
            ) : null
          )}
        </div>

        <section className="financial-panel financial-panel-flat">
          <h3>Margen directo</h3>
          {hasMargenByFamily || hasMargenTrend ? (
            <div className="financial-report-charts-grid">
              {hasMargenByFamily && margenByFamilySpec ? (
                <ChartTile
                  onEnlarge={() =>
                    setEnlargedChart({ title: "Margen directo por familia", spec: margenByFamilySpec })
                  }
                  spec={margenByFamilySpec}
                />
              ) : null}
              {hasMargenTrend && margenBarTrendSpec ? (
                <ChartTile
                  onEnlarge={() =>
                    setEnlargedChart({ title: "Evolución del margen", spec: margenBarTrendSpec })
                  }
                  spec={margenBarTrendSpec}
                />
              ) : null}
              {hasMargenTrend && margenPctTrendSpec ? (
                <ChartTile
                  onEnlarge={() =>
                    setEnlargedChart({ title: "Evolución del margen %", spec: margenPctTrendSpec })
                  }
                  spec={margenPctTrendSpec}
                />
              ) : null}
            </div>
          ) : (
            <p className="muted">Sin margen calculado en el rango seleccionado.</p>
          )}
        </section>

        {hasMargenByFamily ? (
          <details className="financial-report-table-accordion">
            <summary>
              <ReportChevron />
              Margen directo por familia — detalle
            </summary>
            {renderTable(buildMargenTableRows(margenByFamilyRows, "familia", "Familia"), {
              columns: ["Familia", "Ingresos", "% del total", "Margen", "Margen %"],
              tableClassName: "financial-report-data-table",
              wrapClassName: "financial-report-table-wrap"
            })}
          </details>
        ) : null}

        {margenByCanalRows.length > 0 ? (
          <details className="financial-report-table-accordion">
            <summary>
              <ReportChevron />
              Mix y margen por canal
            </summary>
            {renderTable(buildMargenTableRows(margenByCanalRows, "canal", "Canal"), {
              columns: ["Canal", "Ingresos", "% del total", "Margen", "Margen %"],
              tableClassName: "financial-report-data-table",
              wrapClassName: "financial-report-table-wrap"
            })}
            <p className="muted financial-report-solvencia-note">
              Incluye todas las ventas, también las intercompañía (06 - Partes Relacionadas) —
              usa el filtro de canal para excluirlas.
            </p>
          </details>
        ) : null}

        {margenByProductRows.length > 0 ? (
          <details className="financial-report-table-accordion">
            <summary>
              <ReportChevron />
              Top productos: ingresos y margen
            </summary>
            {renderTable(buildMargenTableRows(margenByProductRows, "producto", "Producto"), {
              columns: ["Producto", "Ingresos", "% del total", "Margen", "Margen %"],
              tableClassName: "financial-report-data-table",
              wrapClassName: "financial-report-table-wrap"
            })}
          </details>
        ) : null}

        <details className="financial-report-table-accordion">
          <summary>
            <ReportChevron />
            Ventas por cliente y mes
          </summary>
          {renderTable(clientsByMonthRows, {
            columns: clientsByMonthRows.length > 0 ? Object.keys(clientsByMonthRows[0]) : [],
            tableClassName: "financial-report-data-table",
            wrapClassName: "financial-report-table-wrap"
          })}
        </details>
      </>
    );
  }

  function renderProductionView() {
    const topProductionSpec = buildMultiSeriesBarSpec(topProductionRows, {
      groupKeyCandidates: ["grupo", "producto"],
      title: "Top productos producidos por mes",
      barmode: "group"
    });
    const prodByFamilySpec = buildMultiSeriesBarSpec(prodByFamilyRows, {
      groupKeyCandidates: ["grupo", "familia"],
      title: "Producción por familia",
      barmode: "stack"
    });

    return (
      <div className="financial-report-view-prod">
        <div className="financial-grid-two financial-report-prod-charts" ref={prodChartsRef}>
          {topProductionSpec ? (
            <section className="financial-panel financial-chart-card">
              <PlotlyChart spec={withChartHeight(topProductionSpec, prodChartPlotHeight)} />
            </section>
          ) : null}
          {prodByFamilySpec ? (
            <section className="financial-panel financial-chart-card">
              <PlotlyChart spec={withChartHeight(prodByFamilySpec, prodChartPlotHeight)} />
            </section>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`financial-page-shell financial-page-shell-with-assistant${
        REPORT_ASSISTANT_ENABLED && isAssistantOpen && !isAssistantMobile ? " is-assistant-open" : ""
      }`}
    >
      <div className="financial-report-layout-main">
      <section className="financial-panel financial-report-header-panel">
        <div className="financial-report-title-row">
          <h1>Report financiero</h1>

          <div className="financial-report-header-filters">
            {SOCIEDAD_PICKER_ENABLED ? (
              <FilterOptionPicker
                isOpen={openDropdown === "sociedad"}
                label="Sociedad"
                onSelect={(company) => {
                  updateFilter("sociedad", company);
                  setOpenDropdown(null);
                }}
                onToggle={() =>
                  setOpenDropdown((current) => (current === "sociedad" ? null : "sociedad"))
                }
                options={initialCatalog.sociedades}
                value={filters.sociedad}
                valueLabels={COMPANY_LABELS}
              />
            ) : null}
            <div className="financial-report-inline-filter" data-report-dropdown="true">
              <button
                aria-expanded={openDropdown === "view"}
                className={`financial-report-inline-filter-btn financial-report-view-picker-btn${
                  openDropdown === "view" ? " is-open" : ""
                }`}
                onClick={() => setOpenDropdown((current) => (current === "view" ? null : "view"))}
                type="button"
              >
                <span className="financial-report-inline-filter-val">
                  {VIEW_MODES.find((mode) => mode.key === filters.viewMode)?.label ?? filters.viewMode}
                </span>
                <ReportChevron />
              </button>

              {openDropdown === "view" ? (
                <div className="financial-report-option-popover financial-report-option-popover-left">
                  {VIEW_MODES.map((viewMode) => (
                    <button
                      className={`financial-report-option-item${
                        filters.viewMode === viewMode.key ? " is-selected" : ""
                      }`}
                      key={viewMode.key}
                      onClick={() => {
                        setOpenDropdown(null);
                        void loadReport({ ...filters, viewMode: viewMode.key });
                      }}
                      type="button"
                    >
                      <span>{viewMode.label}</span>
                      {filters.viewMode === viewMode.key ? <span aria-hidden="true">✓</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {DIMENSION_FILTERS_ENABLED && filters.viewMode === "pg" ? (
              <>
                <FilterOptionPicker
                  allLabel="Todas"
                  isOpen={openDropdown === "lineaNegocio"}
                  label="Línea Negocio"
                  onSelect={(value) => {
                    void loadReport({ ...filters, lineaNegocio: value });
                  }}
                  onToggle={() =>
                    setOpenDropdown((current) => (current === "lineaNegocio" ? null : "lineaNegocio"))
                  }
                  options={initialCatalog.lineas_negocio ?? []}
                  value={filters.lineaNegocio}
                />
                <FilterOptionPicker
                  allLabel="Todas"
                  isOpen={openDropdown === "planta"}
                  label="Planta"
                  onSelect={(value) => {
                    void loadReport({ ...filters, planta: value });
                  }}
                  onToggle={() => setOpenDropdown((current) => (current === "planta" ? null : "planta"))}
                  options={initialCatalog.plantas ?? []}
                  value={filters.planta}
                />
              </>
            ) : null}

            {DIMENSION_FILTERS_ENABLED && filters.viewMode === "sales" ? (
              <>
                <FilterOptionPicker
                  allLabel="Todos"
                  isOpen={openDropdown === "familia"}
                  label="Familia"
                  onSelect={(value) => {
                    void loadReport({ ...filters, familia: value });
                  }}
                  onToggle={() =>
                    setOpenDropdown((current) => (current === "familia" ? null : "familia"))
                  }
                  options={initialCatalog.familias ?? []}
                  value={filters.familia}
                />
                <FilterOptionPicker
                  allLabel="Todos"
                  isOpen={openDropdown === "canal"}
                  label="Canal"
                  onSelect={(value) => {
                    void loadReport({ ...filters, canal: value });
                  }}
                  onToggle={() => setOpenDropdown((current) => (current === "canal" ? null : "canal"))}
                  options={initialCatalog.canales ?? []}
                  value={filters.canal}
                />
              </>
            ) : null}

            {/* El toggle "Incluir partes relacionadas" se retiró (16-jul-2026,
                decisión de Pablo): el canal 06 es facturación intercompañía en
                extinción (2,7M jul-2026 vs ~70M de mercado) y activarlo solo
                producía KPIs inflados. El plumbing (incluirPartesRelacionadas,
                siempre false) se conserva por si hubiera que reactivarlo. */}
            <PeriodPicker
              id="report-start"
              isOpen={openDropdown === "start"}
              label="Inicio"
              onChange={(period) => {
                updateFilter("startPeriod", period);
                setOpenDropdown(null);
              }}
              onToggle={() => setOpenDropdown((current) => (current === "start" ? null : "start"))}
              periods={periodOptions}
              value={filters.startPeriod}
            />
            <PeriodPicker
              align="right"
              id="report-end"
              isOpen={openDropdown === "end"}
              label="Fin"
              onChange={(period) => {
                updateFilter("endPeriod", period);
                setOpenDropdown(null);
              }}
              onToggle={() => setOpenDropdown((current) => (current === "end" ? null : "end"))}
              periods={periodOptions}
              value={filters.endPeriod}
            />
            <div className="financial-report-inline-filter" data-report-dropdown="true">
              <button
                className={`financial-report-inline-filter-btn${isLoading ? " is-refreshing" : ""}`}
                disabled={isLoading || invalidRange}
                onClick={() => void loadReport(filters, { force: true })}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="financial-report-refresh-icon"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M20 12a8 8 0 1 1-2.34-5.66"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                  <path d="M20 4v4h-4" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                </svg>
                <span className="financial-report-inline-filter-val">
                  {isLoading ? "Actualizando..." : "Actualizar"}
                </span>
              </button>
            </div>
          </div>
        </div>

        {viewKpis.length > 0 ? (
          <div className="financial-report-view-bar">
            <div className={`financial-report-view-kpis${filters.viewMode === "sales" ? " financial-report-view-kpis-sales" : ""}`}>
              {viewKpis.map((kpi) => (
                <div className="financial-report-view-kpi" key={kpi.label}>
                  <span className="financial-report-view-kpi-label">{kpi.label}</span>
                  <span className="financial-report-view-kpi-value">{kpi.value}</span>
                  {kpi.delta ? (
                    <span
                      className={`financial-report-view-kpi-delta${
                        kpi.delta.startsWith("-")
                          ? " is-negative"
                          : kpi.delta.startsWith("+")
                            ? " is-positive"
                            : ""
                      }`}
                    >
                      {kpi.delta}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {error ? <div className="banner banner-error">{error}</div> : null}
      {invalidRange ? (
        <div className="banner banner-error">
          El periodo de inicio no puede ser posterior al periodo de cierre.
        </div>
      ) : null}

      {!summary && !error ? (
        <div className="financial-empty-state">No se pudo preparar el resumen financiero.</div>
      ) : null}

      {summary ? (
        activeSectionLoaded || !isLoading ? (
          <>
            {filters.viewMode === "pg" || filters.viewMode === "eur_ton" ? renderPygView() : null}
            {filters.viewMode === "solvencia" ? renderSolvenciaView() : null}
            {filters.viewMode === "flujo" ? renderFlujoView() : null}
            {filters.viewMode === "clients_geo" ? renderClientsGeoView() : null}
            {filters.viewMode === "sales" ? renderSalesView() : null}
            {filters.viewMode === "prod" ? renderProductionView() : null}
          </>
        ) : (
          <div className="financial-empty-state">Cargando sección…</div>
        )
      ) : null}

      </div>

      {enlargedChart ? (
        <div
          aria-label="Gráfico ampliado"
          className="financial-report-chart-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setEnlargedChart(null);
            }
          }}
          role="dialog"
        >
          <div className="financial-report-chart-overlay-card">
            <div className="financial-report-chart-overlay-head">
              <h2>{enlargedChart.title}</h2>
              <button
                aria-label="Cerrar"
                className="financial-report-chart-overlay-close"
                onClick={() => setEnlargedChart(null)}
                type="button"
              >
                ×
              </button>
            </div>
            <PlotlyChart spec={withChartHeight(enlargedChart.spec, 460)} />
          </div>
        </div>
      ) : null}

      {REPORT_ASSISTANT_ENABLED ? (
        <>
          {!isAssistantOpen ? (
            <button
              aria-label="Abrir asistente del reporte"
              className="financial-report-assistant-fab"
              onClick={() => setIsAssistantOpen(true)}
              type="button"
            >
              🤖
            </button>
          ) : null}

          {isAssistantOpen ? (
            <>
              {isAssistantMobile ? (
                <button
                  aria-label="Cerrar asistente"
                  className="financial-report-assistant-backdrop"
                  onClick={() => setIsAssistantOpen(false)}
                  type="button"
                />
              ) : null}
              <ReportAssistantPanel
                dataSource={dataSource}
                endPeriod={endPeriod}
                isMobile={isAssistantMobile}
                isOpen={isAssistantOpen}
                onClose={() => setIsAssistantOpen(false)}
                reportContext={reportContext}
                reportLineage={reportLineage}
                sociedad={COMPANY_LABELS[filters.sociedad] ?? filters.sociedad}
                sociedadCode={filters.sociedad}
                startPeriod={startPeriod}
                viewMode={filters.viewMode}
              />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
