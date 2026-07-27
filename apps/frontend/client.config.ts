// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

export interface ClientBranding {
  productName: string;
  metadataTitle: string;
  metadataDescription: string;
  loginTitle: string;
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
    hydrocarburos: { enabled: boolean };
    profile: ProfileConfig;
  };
}

// ---------------------------------------------------------------------------
// Client config — Proan (único cliente, sin diferenciación)
// ---------------------------------------------------------------------------

export const clientConfig: ClientConfig = {
  defaultAuthenticatedRoute: "/hidrocarburos",
  branding: {
    productName: "Hidrocarburos",
    metadataTitle: "Hidrocarburos",
    metadataDescription: "Frontend React de Hidrocarburos para Proan.",
    loginTitle: "Hidrocarburos",
  },
  features: {
    hydrocarburos: { enabled: true },
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
