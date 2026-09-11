import { describe, expect, it } from "vitest";
import {
  getClientAddress,
  getLoginRateLimitKey,
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  nextAttemptState
} from "@/lib/auth/login-rate-limit";

describe("rate limiting del login técnico", () => {
  it("permite cinco intentos y bloquea el sexto", () => {
    const now = 1_000_000;
    let attempts: number[] = [];

    for (let attempt = 0; attempt < LOGIN_RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      const state = nextAttemptState(attempts, now + attempt);
      expect(state.allowed).toBe(true);
      attempts = state.attempts;
    }

    const blocked = nextAttemptState(attempts, now + LOGIN_RATE_LIMIT_MAX_ATTEMPTS);
    expect(blocked).toMatchObject({ allowed: false, retryAfterSeconds: 900 });
  });

  it("vuelve a permitir intentos cuando vence la ventana", () => {
    const now = 1_000_000;
    const attempts = Array.from({ length: LOGIN_RATE_LIMIT_MAX_ATTEMPTS }, () => now);

    expect(nextAttemptState(attempts, now + LOGIN_RATE_LIMIT_WINDOW_MS + 1)).toMatchObject({
      allowed: true,
      attempts: [now + LOGIN_RATE_LIMIT_WINDOW_MS + 1]
    });
  });

  it("obtiene la primera IP de X-Forwarded-For", () => {
    const request = new Request("https://example.test/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.10, 198.51.100.2" }
    });

    expect(getClientAddress(request)).toBe("203.0.113.10");
  });

  it("deriva claves distintas y sin la IP original", () => {
    const first = getLoginRateLimitKey("203.0.113.10");
    const second = getLoginRateLimitKey("203.0.113.11");

    expect(first).not.toBe(second);
    expect(first).not.toContain("203.0.113.10");
  });
});
