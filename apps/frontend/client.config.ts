// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

export interface ClientBranding {
  productName: string;
  metadataTitle: string;
  metadataDescription: string;
  loginTitle: string;
  nav: {
    report: string;
    alerts: string;
  };
}

export interface ToggleFeatureConfig {
  enabled: boolean;
}

export type ReportViewModeKey =
  | "pg"
  | "eur_ton"
  | "solvencia"
  | "sales"
  | "prod"
  | "flujo"
  | "clients_geo";

export interface ReportConfig extends ToggleFeatureConfig {
  assistant: {
    enabled: boolean;
  };
  /** ISO 4217 currency code used for monetary values in the report (e.g. "EUR", "MXN"). */
  currency: string;
  /** Selector de Sociedad en la cabecera. Solo aplica a backends Azure SQL. */
  sociedadPicker: boolean;
  /** Filtros contextuales por vista: Línea Negocio+Planta (P&G) y
   * Familia+Canal (Rentab. Comercial). */
  dimensionFilters: boolean;
  /** Pestañas de vista disponibles, en orden, con su label visible. */
  viewModes: Array<{ key: ReportViewModeKey; label: string }>;
}

export interface ProfileConfig {
  enabled: boolean;
  instructions: boolean;
  accessibleSchemas: boolean;
  persistentDocuments: boolean;
  documentPreview: boolean;
}

// ---------------------------------------------------------------------------
// Top-level client config
// ---------------------------------------------------------------------------

export interface ClientConfig {
  defaultAuthenticatedRoute: string;
  branding: ClientBranding;
  features: {
    report: ReportConfig;
    alerts: ToggleFeatureConfig;
    profile: ProfileConfig;
  };
}

// ---------------------------------------------------------------------------
// Client config — Proan (único cliente, sin diferenciación)
// ---------------------------------------------------------------------------

export const clientConfig: ClientConfig = {
  defaultAuthenticatedRoute: "/report",
  branding: {
    productName: "FinancialAI",
    metadataTitle: "FinancialAI",
    metadataDescription: "Frontend React de FinancialAI para Proan.",
    loginTitle: "FinancialAI",
    nav: {
      report: "REPORT",
      alerts: "ALERTAS",
    },
  },
  features: {
    report: {
      enabled: true,
      // Asistente ("preguntar al reporte") desactivado: es la parte tipo-agente
      // (endpoint /ask del gateway de Maka) que NO se portó a Hidrocarburos.
      assistant: { enabled: false },
      currency: "MXN",
      sociedadPicker: false,
      dimensionFilters: true,
      viewModes: [
        { key: "pg", label: "P&G" },
        { key: "solvencia", label: "Rentab. y Solvencia" },
        { key: "flujo", label: "Flujo de Recursos" },
        { key: "sales", label: "Rentab. Comercial" },
        { key: "clients_geo", label: "Clientes y Geografía" }
      ]
    },
    alerts: { enabled: true },
    profile: {
      enabled: true,
      instructions: false,
      accessibleSchemas: false,
      persistentDocuments: false,
      documentPreview: false
    },
  },
};

export function getDefaultAuthenticatedRoute(config: ClientConfig = clientConfig): string {
  return config.defaultAuthenticatedRoute;
}
