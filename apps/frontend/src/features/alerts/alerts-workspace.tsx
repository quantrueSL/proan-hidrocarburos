"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  FinancialbiAlertsMtdResponse,
  FinancialbiAlertsResponse,
  FinancialbiCatalog,
  FinancialbiHistoria,
  FinancialbiHistoriasMtdResponse,
  FinancialbiHistoriasResponse
} from "@/types/financialbi";

type AlertsFilters = {
  period: string;
};

type AlertsWorkspaceProps = {
  initialAlerts: FinancialbiAlertsResponse | null;
  initialAlertsMtd: FinancialbiAlertsMtdResponse | null;
  initialCatalog: FinancialbiCatalog;
  initialError: string | null;
  initialFilters: AlertsFilters;
  initialHistorias: FinancialbiHistoriasResponse | null;
  initialHistoriasMtd: FinancialbiHistoriasMtdResponse | null;
};

type AlertChatbiMode = {
  schema: "maka_bigquery";
  periodo: string;
  ruleId: string;
  scopeId: string;
};

type AlertAgentHandoff = {
  source: "alerts";
  handoffId: string;
  createdAt: string;
  period: string;
  group: string;
  pattern: string;
  title: string;
  summary: string;
  ruleId: string;
  ruleLabel: string;
  scopeId: string;
  detalle: string;
  tier: string;
  score: number | null;
  trendType: string;
  trendDirection: string;
  trendN: number | null;
  valor: number | null;
  umbral: number | null;
  deltaPct: number | null;
  chatbiMode: AlertChatbiMode;
  prompt: string;
};

const ALERT_AGENT_HANDOFF_STORAGE_KEY = "aitor_alert_agent_handoff";

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

const RULE_LABELS: Record<string, string> = {
  V1: "Ventas fuera de rango",
  V3: "Concentración clientes",
  V4: "Cliente anómalo",
  R1: "Ventas fuera de ritmo (mes a la fecha)",
  R4: "Cliente fuera de ritmo (mes a la fecha)",
  B1: "Margen bruto fuera de rango",
  B2: "EBITDA anómalo",
  B3: "Gastos operativos inusuales",
  B4: "Grupo de balance atípico",
  A1: "Saldo por pagar fuera de rango",
  A2: "Aging vencido (acreedores) anómalo",
  A3: "Proveedor anómalo",
  D1: "Saldo por cobrar fuera de rango",
  D2: "Aging vencido (deudores) anómalo",
  D3: "Cliente moroso anómalo",
  ERROR: "Error en detector"
};

const GROUP_LABELS: Record<string, string> = {
  V: "Ventas",
  R: "Ventas (mes a la fecha)",
  B: "Balance",
  A: "Acreedores",
  D: "Deudores"
};

const ALERT_GROUP_ORDER = ["B", "V", "A", "D"] as const;

const TIER_COLORS: Record<string, string> = {
  CRÍTICO: "#D32F2F",
  ATENCIÓN: "#F57C00",
  SEGUIMIENTO: "#1565C0",
  POSITIVO: "#2E7D32"
};

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
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

function readErrorMessage(response: Response, fallback: string) {
  return response
    .json()
    .then((payload: { detail?: string }) => payload.detail ?? fallback)
    .catch(() => fallback);
}

function inferGroupFromRule(ruleId: string) {
  const prefix = ruleId.trim().charAt(0).toUpperCase();
  return prefix in GROUP_LABELS ? prefix : "B";
}

function inferGroupFromHistoria(historia: FinancialbiHistoria) {
  // rule_id es la fuente exacta del grupo (V/R/B/A/D); el texto del patrón
  // causal es solo un fallback.
  const ruleId = getString(historia.rule_id).trim();
  if (ruleId) {
    return inferGroupFromRule(ruleId);
  }

  const pattern = getString(historia.causal_pattern);
  if (pattern.includes("ACREEDOR") || pattern.includes("PROVEEDOR")) {
    return "A";
  }

  if (pattern.includes("DEUDOR") || pattern.includes("MOROSO")) {
    return "D";
  }

  if (pattern.includes("RITMO")) {
    return "R";
  }

  if (pattern.includes("VENTAS") || pattern.includes("CLIENTE")) {
    return "V";
  }

  return "B";
}

const ALERT_CURRENCY = "MXN";

function formatAlertMetricValue(ruleId: string, value: number | null) {
  if (value === null) {
    return "—";
  }

  const format = (input: number, digits: number) =>
    new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits }).format(input);

  switch (ruleId) {
    case "B1":
    case "A2":
    case "D2":
      return `${format(value * 100, 1)}%`;
    case "V3":
      return format(value, 3);
    default:
      // V1, V4, R1, R4, B2, B3, B4, A1, A3, D1, D3 — métricas monetarias
      return `${format(value, 0)} ${ALERT_CURRENCY}`;
  }
}

function formatAlertDelta(ruleId: string, deltaPct: number | null) {
  if (deltaPct === null) {
    return "—";
  }

  const pct = new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 1,
    signDisplay: "always"
  }).format(deltaPct * 100);

  // B1 mide diferencia de ratios: su delta viene en puntos, no en % relativo.
  return ruleId === "B1" ? `${pct} puntos porcentuales` : `${pct}%`;
}

function buildTrendLine(trendType: string, trendDirection: string, trendN: number | null) {
  const direction =
    trendDirection === "UP" ? "al alza" : trendDirection === "DOWN" ? "a la baja" : "";
  const months =
    trendN !== null && trendN > 0 ? `${trendN} meses consecutivos` : "varios meses";

  if (trendType === "ACELERACION") {
    return `lleva ${months} ${direction} y además está acelerando`.replace(/\s{2,}/g, " ");
  }

  if (trendType === "TENDENCIA") {
    return `lleva ${months} ${direction} (movimiento sostenido, no puntual)`.replace(/\s{2,}/g, " ");
  }

  if (trendType === "PUNTUAL") {
    return "es un cambio puntual de este mes; el mes anterior estaba en rango normal";
  }

  return "";
}

const RULE_DETECTION_METHOD: Record<string, string> = {
  B2: "el EBITDA del mes se comparó con el del mes anterior (se alerta a partir de ±15%); si no hay mes anterior, con su rango IQR de los 24 meses previos.",
  V4: "las compras del mes se compararon con la mediana histórica de los meses con compra del cliente (rango IQR sobre los 24 meses previos).",
  A3: "el saldo por pagar del mes se comparó con la mediana histórica de los meses con saldo del proveedor (rango IQR sobre los 24 meses previos).",
  D3: "el saldo por cobrar del mes se comparó con la mediana histórica de los meses con saldo del cliente (rango IQR sobre los 24 meses previos).",
  R1: "las ventas acumuladas desde el día 1 hasta hoy se compararon con el acumulado hasta el mismo día calendario en los 24 meses anteriores (rango IQR) — no se compara contra el mes completo.",
  R4: "las compras acumuladas a la fecha se compararon con la mediana histórica de meses con compra del cliente, acotada al mismo día calendario (rango IQR sobre los 24 meses previos)."
};

const DEFAULT_DETECTION_METHOD =
  "el valor del mes se comparó con su rango normal histórico (IQR sobre los 24 meses previos; referencia = mediana) y quedó fuera del rango.";

// Instrucciones de esquema para el handoff a ChatBI: Maka corre 100% sobre
// BigQuery (proyecto proan-quantrue). Las tablas de detalle que usa el motor
// de alertas viven en el dataset D50_AGGREGATE_RENTABILIDAD, prefijo MAKA_
// (migradas 2026-07-20 — ver apps/financialbi/financialbi/alertas_engine.py
// y report_engine.py, y config/db_schema/database_info.txt para el detalle
// de columnas).
function buildBigqueryModeInstructions(ruleId: string, scopeEntity: string) {
  const groupKey = inferGroupFromRule(ruleId);
  const lines: string[] = [];

  if (groupKey === "V" || groupKey === "R") {
    lines.push(
      "- Tabla fuente: `proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_VENTAS_RECETAS_COSTESMP` (ventas por línea, cliente, lote y receta). Excluye el canal \"06 - Partes Relacionadas\" (facturación intercompañía PAN<->MPE) salvo que la alerta sea justo sobre ese canal."
    );
    if (groupKey === "R") {
      lines.push(
        "- Esta alerta es de \"ritmo\" (mes a la fecha): compara el acumulado del mes en curso hasta hoy contra el acumulado hasta el mismo día calendario en meses anteriores. Filtra `EXTRACT(DAY FROM billing_date) <= LEAST(EXTRACT(DAY FROM CURRENT_DATE()), EXTRACT(DAY FROM LAST_DAY(billing_date)))` en cualquier consulta comparativa."
      );
    }
  } else if (groupKey === "B") {
    lines.push(
      "- Tablas fuente: `proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_PYG_MENSUAL` (subtotales de P&G: ventas netas, margen bruto, EBITDA, gasto de operación) y `MAKA_BALANCE_GRUPOS` (saldo por grupo de balance: bancos, cxc, inventarios, cxp, deuda bancaria...)."
    );
    if (ruleId === "B4") {
      lines.push(
        `- Esta regla es por grupo de balance${scopeEntity ? ` (grupo '${scopeEntity}')` : ""}: usa MAKA_BALANCE_GRUPOS filtrando anio/mes, columna del grupo correspondiente.`
      );
    }
  } else if (groupKey === "A") {
    lines.push(
      "- Tabla fuente: `proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_ACREEDORES` (saldos y aging de cuentas por pagar por proveedor, 1 fila por año/mes/proveedor). Un proveedor puede tener varias filas por (anio,mes) por área de negocio o moneda — agrega con SUM/GROUP BY razon_social si necesitas el total."
    );
  } else if (groupKey === "D") {
    lines.push(
      "- Tabla fuente: `proan-quantrue.D50_AGGREGATE_RENTABILIDAD.MAKA_DEUDORES` (saldos y aging de cuentas por cobrar por cliente, mismo diseño que acreedores)."
    );
  }

  lines.push(
    "- `saldo_neto` es el total adeudado (todo el aging); para \"vencido a más de N días\" usa las columnas de bucket (bucket_0_30, bucket_31_60, bucket_61_90, bucket_90_mas), nunca saldo_neto."
  );

  return lines;
}

function buildAlertAgentPrompt(
  handoff: Omit<AlertAgentHandoff, "prompt" | "chatbiMode">
) {
  const separatorIndex = handoff.scopeId.indexOf(":");
  const scopeEntity =
    separatorIndex >= 0 ? handoff.scopeId.slice(separatorIndex + 1) : handoff.scopeId;

  const entityLine =
    handoff.ruleId === "B4" && scopeEntity
      ? `- Entidad afectada: grupo de balance '${scopeEntity}'`
      : (handoff.ruleId === "V4" || handoff.ruleId === "R4") && scopeEntity
        ? `- Entidad afectada: cliente con customer_number '${scopeEntity}'`
        : handoff.ruleId === "A3" && scopeEntity
          ? `- Entidad afectada: proveedor '${scopeEntity}'`
          : handoff.ruleId === "D3" && scopeEntity
            ? `- Entidad afectada: cliente '${scopeEntity}'`
            : "";

  const trendLine = buildTrendLine(
    handoff.trendType,
    handoff.trendDirection,
    handoff.trendN
  );
  const bigqueryInstructions = buildBigqueryModeInstructions(handoff.ruleId, scopeEntity);

  return [
    `Contexto de alerta financiera detectada (regla ${handoff.ruleId} — ${handoff.ruleLabel}):`,
    `- Período: ${handoff.period}`,
    ...(entityLine ? [entityLine] : []),
    `- Severidad: ${handoff.tier}${handoff.score !== null ? ` (score ${handoff.score})` : ""} | Patrón causal: ${handoff.pattern}`,
    `- Título: ${handoff.title}`,
    `- Resumen: ${handoff.summary}`,
    ...(handoff.detalle ? [`- Qué detectó el motor: ${handoff.detalle}`] : []),
    `- Valor actual: ${formatAlertMetricValue(handoff.ruleId, handoff.valor)} | Referencia/umbral: ${formatAlertMetricValue(handoff.ruleId, handoff.umbral)} | Δ: ${formatAlertDelta(handoff.ruleId, handoff.deltaPct)}`,
    ...(trendLine ? [`- Tendencia: ${trendLine}.`] : []),
    `- Método de detección: ${RULE_DETECTION_METHOD[handoff.ruleId] ?? DEFAULT_DETECTION_METHOD}`,
    "",
    "INSTRUCCIONES:",
    "- Estos valores son DEFINITIVOS y provienen del motor de reporting financiero. NO recalcules el KPI ni re-estimes la alerta.",
    "- Tu tarea es CONFIRMAR estos valores contra BigQuery y, si hace falta, investigar la causa con el mínimo de consultas.",
    ...bigqueryInstructions,
    "- En ESTE mensaje responde con UNA única consulta SELECT sencilla (BigQuery Standard SQL, usa LIMIT para acotar filas); el resto de la investigación continúa en los siguientes mensajes de esta conversación.",
    "- Reglas del SQL: una sola SELECT; los filtros sobre agregados van en HAVING (nunca en WHERE); nombra las tablas completas con backticks, ej. `proan-quantrue.D50_AGGREGATE_RENTABILIDAD.TABLA`.",
    "- Con los datos en la mano, da una explicación razonada: la causa más probable, la evidencia numérica que la respalda y qué convendría revisar a continuación.",
    "- En tu respuesta final escribe SOLO el análisis en texto plano y en español: no incluyas el SQL, ni bloques de código, ni encabezados en inglés."
  ].join("\n");
}

function AlertsChevron() {
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

function AlertPeriodPicker({
  isOpen,
  onChange,
  onToggle,
  periods,
  value
}: {
  isOpen: boolean;
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
    <div className="financial-report-inline-filter" data-alerts-dropdown="true">
      <button
        aria-expanded={isOpen}
        className={`financial-report-inline-filter-btn${isOpen ? " is-open" : ""}`}
        id="alerts-period"
        onClick={onToggle}
        type="button"
      >
        <span className="financial-report-inline-filter-lab">Periodo</span>
        <span className="financial-report-inline-filter-val">{formatPeriodLongLabel(value)}</span>
        <AlertsChevron />
      </button>

      {isOpen ? (
        <div className="financial-period-popover financial-report-period-popover">
          <div className="financial-period-yearbar">
            <button
              aria-label="Año anterior"
              className="financial-period-year-nav"
              disabled={!previousYear}
              onClick={() => previousYear ? setSelectedYear(previousYear) : undefined}
              type="button"
            >
              ‹
            </button>
            <span>{selectedYear}</span>
            <button
              aria-label="Año siguiente"
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

export function AlertsWorkspace({
  initialAlerts,
  initialAlertsMtd,
  initialCatalog,
  initialError,
  initialFilters,
  initialHistorias,
  initialHistoriasMtd
}: AlertsWorkspaceProps) {
  const router = useRouter();
  const [alertsData, setAlertsData] = useState(initialAlerts);
  const [historiasData, setHistoriasData] = useState(initialHistorias);
  const [alertsMtdData, setAlertsMtdData] = useState(initialAlertsMtd);
  const [historiasMtdData, setHistoriasMtdData] = useState(initialHistoriasMtd);
  const [filters, setFilters] = useState(initialFilters);
  const [error, setError] = useState(initialError);
  const [mtdError, setMtdError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMtd, setIsLoadingMtd] = useState(false);
  const [activeCadence, setActiveCadence] = useState<"mensual" | "ritmo">("mensual");
  const [openDropdown, setOpenDropdown] = useState<"period" | "cadence" | null>(null);

  const periodOptions = useMemo(
    () => Array.from(new Set(initialCatalog.meses)).sort(),
    [initialCatalog.meses]
  );

  useEffect(() => {
    if (!openDropdown || typeof document === "undefined") {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-alerts-dropdown="true"]')) {
        setOpenDropdown(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openDropdown]);

  const targetPeriod = filters.period;
  const historias = historiasData?.historias ?? [];
  const historiasMtd = historiasMtdData?.historias ?? [];
  const errorRows = (alertsData?.rows ?? []).filter(
    (row) => getString(row.rule_id).trim().toUpperCase() === "ERROR"
  );
  const errorRowsMtd = (alertsMtdData?.rows ?? []).filter(
    (row) => getString(row.rule_id).trim().toUpperCase() === "ERROR"
  );

  const storyCounts = historias.reduce<Record<string, number>>(
    (accumulator, historia) => {
      const group = inferGroupFromHistoria(historia);
      accumulator[group] = (accumulator[group] ?? 0) + 1;
      return accumulator;
    },
    { B: 0, V: 0, A: 0, D: 0 }
  );
  const groupedHistorias = historias.reduce<Record<string, FinancialbiHistoria[]>>(
    (accumulator, historia) => {
      const group = inferGroupFromHistoria(historia);
      accumulator[group].push(historia);
      return accumulator;
    },
    { B: [], V: [], A: [], D: [] }
  );

  function handleAlertAgentHandoff(historia: FinancialbiHistoria, periodLabel: string) {
    if (typeof window === "undefined") {
      return;
    }

    const group = inferGroupFromHistoria(historia);
    const ruleId = getString(historia.rule_id).trim().toUpperCase();
    const payloadBase = {
      source: "alerts" as const,
      handoffId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      period: getString(historia.periodo) || periodLabel,
      group: GROUP_LABELS[group] ?? "Balance",
      pattern: getString(historia.causal_pattern) || "Historia",
      title: getString(historia.titulo_llm || historia.titulo) || "Alerta",
      summary:
        getString(historia.resumen_llm || historia.resumen) ||
        "Sin resumen disponible.",
      ruleId,
      ruleLabel: RULE_LABELS[ruleId] ?? ruleId,
      scopeId: getString(historia.scope_id),
      detalle: getString(historia.detalle),
      tier: getString(historia.tier || historia.tier_max) || "SEGUIMIENTO",
      score: getNumber(historia.score_riesgo),
      trendType: getString(historia.trend_type),
      trendDirection: getString(historia.trend_direction),
      trendN: getNumber(historia.trend_n),
      valor: getNumber(historia.valor),
      umbral: getNumber(historia.umbral),
      deltaPct: getNumber(historia.delta_pct)
    };
    const chatbiMode: AlertChatbiMode = {
      schema: "maka_bigquery",
      periodo: payloadBase.period,
      ruleId: payloadBase.ruleId,
      scopeId: payloadBase.scopeId
    };
    const payload: AlertAgentHandoff = {
      ...payloadBase,
      chatbiMode,
      prompt: buildAlertAgentPrompt(payloadBase)
    };

    window.sessionStorage.setItem(
      ALERT_AGENT_HANDOFF_STORAGE_KEY,
      JSON.stringify(payload)
    );
    router.push("/agent");
  }

  async function loadAlerts(nextFilters: AlertsFilters) {
    setOpenDropdown(null);
    setFilters(nextFilters);
    setIsLoading(true);
    setError(null);

    try {
      const requestBody = {
        target_period: nextFilters.period
      };

      const [alertsResponse, historiasResponse] = await Promise.all([
        fetch("/api/financialbi/alerts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        }),
        fetch("/api/financialbi/historias", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        })
      ]);

      if (!alertsResponse.ok) {
        throw new Error(
          await readErrorMessage(alertsResponse, "No se pudieron cargar las alertas.")
        );
      }

      if (!historiasResponse.ok) {
        throw new Error(
          await readErrorMessage(historiasResponse, "No se pudieron cargar las historias.")
        );
      }

      setAlertsData((await alertsResponse.json()) as FinancialbiAlertsResponse);
      setHistoriasData((await historiasResponse.json()) as FinancialbiHistoriasResponse);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar las alertas."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function loadRitmo() {
    setIsLoadingMtd(true);
    setMtdError(null);

    try {
      const [alertsResponse, historiasResponse] = await Promise.all([
        fetch("/api/financialbi/alerts_mtd"),
        fetch("/api/financialbi/historias_mtd")
      ]);

      if (!alertsResponse.ok) {
        throw new Error(
          await readErrorMessage(alertsResponse, "No se pudieron cargar las alertas de ritmo.")
        );
      }

      if (!historiasResponse.ok) {
        throw new Error(
          await readErrorMessage(historiasResponse, "No se pudieron cargar las historias de ritmo.")
        );
      }

      setAlertsMtdData((await alertsResponse.json()) as FinancialbiAlertsMtdResponse);
      setHistoriasMtdData((await historiasResponse.json()) as FinancialbiHistoriasMtdResponse);
    } catch (loadError) {
      setMtdError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar las alertas de ritmo."
      );
    } finally {
      setIsLoadingMtd(false);
    }
  }

  function renderHistoriaCard(historia: FinancialbiHistoria, index: number, periodLabel: string) {
    const tier = getString(historia.tier || historia.tier_max) || "SEGUIMIENTO";
    const tierColor = TIER_COLORS[tier] ?? "#666666";
    const ruleId = getString(historia.rule_id).trim().toUpperCase();

    return (
      <article
        className="financial-story-card"
        key={`${getString(historia.rule_id)}-${index}`}
        style={{
          borderLeftColor: tierColor,
          background: `color-mix(in srgb, ${tierColor} 10%, var(--color-surface))`
        }}
      >
        <div className="financial-story-meta">
          <span>{getString(historia.causal_pattern) || "Historia"}</span>
          <div className="financial-story-meta-actions">
            <span className="financial-story-tier" style={{ backgroundColor: tierColor }}>
              {tier}
            </span>
            <button
              aria-label="Preguntar al agente sobre esta alerta"
              className="financial-story-agent-button"
              onClick={() => handleAlertAgentHandoff(historia, periodLabel)}
              title="Preguntar al agente sobre esta alerta"
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="16"
                viewBox="0 0 24 24"
                width="16"
              >
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="M16 16l4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
              </svg>
            </button>
          </div>
        </div>
        <h3>{getString(historia.titulo_llm || historia.titulo) || "Alerta"}</h3>
        <p className="muted">
          {getString(historia.resumen_llm || historia.resumen) || "Sin resumen disponible."}
        </p>
        <div className="financial-story-values">
          <div className="financial-story-value">
            <span className="financial-story-value-label">Valor</span>
            <span className="financial-story-value-number">
              {formatAlertMetricValue(ruleId, getNumber(historia.valor))}
            </span>
          </div>
          <div className="financial-story-value">
            <span className="financial-story-value-label">Umbral</span>
            <span className="financial-story-value-number">
              {formatAlertMetricValue(ruleId, getNumber(historia.umbral))}
            </span>
          </div>
          <div className="financial-story-value">
            <span className="financial-story-value-label">Delta</span>
            <span className="financial-story-value-number">
              {formatAlertDelta(ruleId, getNumber(historia.delta_pct))}
            </span>
          </div>
        </div>
      </article>
    );
  }

  function renderErrorGroup(rows: Record<string, unknown>[]) {
    if (rows.length === 0) {
      return null;
    }

    return (
      <details className="financial-story-group financial-alerts-error-group">
        <summary className="financial-story-group-header">
          <h2>
            Errores en detectores
            <span className="financial-story-group-count">{String(rows.length)}</span>
          </h2>
          <svg
            aria-hidden="true"
            className="financial-story-group-chevron"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} />
          </svg>
        </summary>
        <div className="financial-story-group-body">
          <div className="financial-table-wrap financial-report-table-wrap">
            <table className="financial-table financial-report-data-table">
              <thead>
                <tr>
                  <th>Regla</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`error-${index}`}>
                    <td>{RULE_LABELS.ERROR}</td>
                    <td>{getString(row.detalle) || "Sin detalle disponible"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    );
  }

  const mtdTooEarly = alertsMtdData?.too_early ?? false;
  const mtdDayOfMonth = alertsMtdData?.day_of_month ?? null;
  const mtdMinDay = alertsMtdData?.min_day ?? 5;
  const mtdCutoffDay = alertsMtdData?.cutoff_day ?? null;

  return (
    <div className="financial-page-shell">
      <section className="financial-panel financial-report-header-panel">
        <div className="financial-report-title-row">
          <h1>Alertas financieras</h1>

          <div className="financial-report-header-filters">
            {activeCadence === "mensual" ? (
              <>
                <AlertPeriodPicker
                  isOpen={openDropdown === "period"}
                  onChange={(period) => {
                    setFilters((current) => ({
                      ...current,
                      period
                    }));
                    setOpenDropdown(null);
                  }}
                  onToggle={() =>
                    setOpenDropdown((current) => (current === "period" ? null : "period"))
                  }
                  periods={periodOptions}
                  value={filters.period}
                />
                <div className="financial-report-inline-filter" data-alerts-dropdown="true">
                  <button
                    className={`financial-report-inline-filter-btn${isLoading ? " is-refreshing" : ""}`}
                    disabled={isLoading}
                    onClick={() => void loadAlerts(filters)}
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
                      {isLoading ? "Actualizando..." : "Recalcular"}
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <div className="financial-report-inline-filter" data-alerts-dropdown="true">
                <button
                  className={`financial-report-inline-filter-btn${isLoadingMtd ? " is-refreshing" : ""}`}
                  disabled={isLoadingMtd}
                  onClick={() => void loadRitmo()}
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
                    {isLoadingMtd ? "Actualizando..." : "Recalcular"}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="financial-report-view-bar">
          <div className="financial-report-inline-filter" data-alerts-dropdown="true">
            <button
              aria-expanded={openDropdown === "cadence"}
              className={`financial-report-inline-filter-btn financial-report-view-picker-btn${
                openDropdown === "cadence" ? " is-open" : ""
              }`}
              onClick={() => setOpenDropdown((current) => (current === "cadence" ? null : "cadence"))}
              type="button"
            >
              <span className="financial-report-inline-filter-val">
                {activeCadence === "mensual" ? "Mensual" : "Mes a la fecha"}
              </span>
              <AlertsChevron />
            </button>

            {openDropdown === "cadence" ? (
              <div className="financial-report-option-popover financial-report-option-popover-left">
                {(["mensual", "ritmo"] as const).map((cadence) => (
                  <button
                    className={`financial-report-option-item${activeCadence === cadence ? " is-selected" : ""}`}
                    key={cadence}
                    onClick={() => {
                      setActiveCadence(cadence);
                      setOpenDropdown(null);
                    }}
                    type="button"
                  >
                    <span>{cadence === "mensual" ? "Mensual" : "Mes a la fecha"}</span>
                    {activeCadence === cadence ? <span aria-hidden="true">✓</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {activeCadence === "mensual" ? (
            <div className="financial-report-view-kpis">
              <div className="financial-report-view-kpi">
                <span className="financial-report-view-kpi-label">Total</span>
                <span className="financial-report-view-kpi-value">{String(historias.length)}</span>
              </div>
              <div className="financial-report-view-kpi">
                <span className="financial-report-view-kpi-label">Balance</span>
                <span className="financial-report-view-kpi-value">{String(storyCounts.B ?? 0)}</span>
              </div>
              <div className="financial-report-view-kpi">
                <span className="financial-report-view-kpi-label">Ventas</span>
                <span className="financial-report-view-kpi-value">{String(storyCounts.V ?? 0)}</span>
              </div>
              <div className="financial-report-view-kpi">
                <span className="financial-report-view-kpi-label">Acreedores</span>
                <span className="financial-report-view-kpi-value">{String(storyCounts.A ?? 0)}</span>
              </div>
              <div className="financial-report-view-kpi">
                <span className="financial-report-view-kpi-label">Deudores</span>
                <span className="financial-report-view-kpi-value">{String(storyCounts.D ?? 0)}</span>
              </div>
            </div>
          ) : !mtdTooEarly ? (
            <div className="financial-report-view-kpis">
              <div className="financial-report-view-kpi">
                <span className="financial-report-view-kpi-label">Total</span>
                <span className="financial-report-view-kpi-value">{String(historiasMtd.length)}</span>
              </div>
              <div className="financial-report-view-kpi">
                <span className="financial-report-view-kpi-label">Acumulado al día</span>
                <span className="financial-report-view-kpi-value">{String(mtdCutoffDay ?? "—")}</span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {activeCadence === "mensual" && error ? (
        <div className="banner banner-error">{error}</div>
      ) : null}
      {activeCadence === "ritmo" && mtdError ? (
        <div className="banner banner-error">{mtdError}</div>
      ) : null}

      <section className="financial-panel">
        {activeCadence === "mensual" ? (
          historias.length > 0 ? (
            <div className="financial-story-groups">
              {ALERT_GROUP_ORDER.map((group) => {
                const groupHistorias = groupedHistorias[group];
                return (
                  <details className="financial-story-group" key={group} open>
                    <summary className="financial-story-group-header">
                      <h2>
                        {GROUP_LABELS[group]}
                        <span className="financial-story-group-count">
                          {String(groupHistorias.length)}
                        </span>
                      </h2>
                      <svg
                        aria-hidden="true"
                        className="financial-story-group-chevron"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} />
                      </svg>
                    </summary>
                    <div className="financial-story-group-body">
                      {groupHistorias.length > 0 ? (
                        <div className="financial-story-grid">
                          {groupHistorias.map((historia, index) =>
                            renderHistoriaCard(historia, index, targetPeriod)
                          )}
                        </div>
                      ) : (
                        <div className="financial-empty-state financial-story-group-empty">
                          No hay alertas de {GROUP_LABELS[group].toLowerCase()}.
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <div className="financial-empty-state">No hay historias para este periodo.</div>
          )
        ) : mtdTooEarly ? (
          <div className="financial-empty-state">
            Las alertas de &ldquo;mes a la fecha&rdquo; se activan a partir del día {mtdMinDay} del mes
            (para evitar ruido cuando el acumulado todavía es muy chico). Hoy es día{" "}
            {mtdDayOfMonth}.
          </div>
        ) : historiasMtd.length > 0 ? (
          <div className="financial-story-groups">
            <details className="financial-story-group" open>
              <summary className="financial-story-group-header">
                <h2>
                  Ventas — acumulado al día {mtdCutoffDay}
                  <span className="financial-story-group-count">{String(historiasMtd.length)}</span>
                </h2>
                <svg
                  aria-hidden="true"
                  className="financial-story-group-chevron"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} />
                </svg>
              </summary>
              <div className="financial-story-group-body">
                <div className="financial-story-grid">
                  {historiasMtd.map((historia, index) =>
                    renderHistoriaCard(historia, index, "mes en curso")
                  )}
                </div>
              </div>
            </details>
          </div>
        ) : (
          <div className="financial-empty-state">
            No hay alertas de ritmo para el acumulado al día {mtdCutoffDay}.
          </div>
        )}

        {activeCadence === "mensual"
          ? renderErrorGroup(errorRows)
          : renderErrorGroup(errorRowsMtd)}
      </section>
    </div>
  );
}
