import type { JwtClaims } from "@/types/auth";

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = normalized + "=".repeat(padding);
  return Buffer.from(padded, "base64").toString("utf8");
}

export function decodeJwtClaims(token: string): JwtClaims {
  const parts = token.split(".");

  if (parts.length < 2) {
    return { apps: [] };
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as Partial<JwtClaims>;
    return {
      sub: payload.sub,
      exp: payload.exp,
      apps: Array.isArray(payload.apps)
        ? payload.apps.filter((value): value is string => typeof value === "string")
        : []
    };
  } catch {
    return { apps: [] };
  }
}

