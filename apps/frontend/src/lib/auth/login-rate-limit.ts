import { createHmac } from "node:crypto";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuthApp } from "@/lib/auth/firebase-admin";
import { getAccessListDatabaseId, getSessionSecret } from "@/lib/env";

export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const LOGIN_RATE_LIMIT_COLLECTION = "hcarb_login_rate_limits";
const FALLBACK_MAX_ENTRIES = 1024;

type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  usedFallback: boolean;
};

type AttemptState = {
  allowed: boolean;
  attempts: number[];
  retryAfterSeconds: number;
};

const fallbackAttempts = new Map<string, number[]>();

function validAttempts(value: unknown, oldestAllowedMs: number): number[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((timestamp): timestamp is Timestamp => timestamp instanceof Timestamp)
    .map((timestamp) => timestamp.toMillis())
    .filter((timestamp) => timestamp >= oldestAllowedMs)
    .sort((left, right) => left - right);
}

export function nextAttemptState(previousAttempts: readonly number[], nowMs: number): AttemptState {
  const attempts = previousAttempts.filter((timestamp) => timestamp >= nowMs - LOGIN_RATE_LIMIT_WINDOW_MS);

  if (attempts.length >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    return {
      allowed: false,
      attempts,
      retryAfterSeconds: Math.max(1, Math.ceil((attempts[0] + LOGIN_RATE_LIMIT_WINDOW_MS - nowMs) / 1000))
    };
  }

  return { allowed: true, attempts: [...attempts, nowMs], retryAfterSeconds: 0 };
}

/** IP del cliente facilitada por el proxy de Cloud Run; nunca se registra. */
export function getClientAddress(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const address = forwardedFor?.split(",")[0]?.trim();
  return address || "unknown";
}

/** Clave no reversible para que Firestore nunca contenga la IP real. */
export function getLoginRateLimitKey(clientAddress: string): string {
  return createHmac("sha256", getSessionSecret()).update(clientAddress).digest("hex");
}

function consumeFallback(key: string, nowMs: number): RateLimitDecision {
  const previous = fallbackAttempts.get(key) ?? [];
  const state = nextAttemptState(previous, nowMs);

  if (state.allowed) {
    fallbackAttempts.set(key, state.attempts);
    if (fallbackAttempts.size > FALLBACK_MAX_ENTRIES) {
      const oldestKey = fallbackAttempts.keys().next().value;
      if (oldestKey) fallbackAttempts.delete(oldestKey);
    }
  }

  return { ...state, usedFallback: true };
}

/** Reserva un intento antes de comparar bcrypt, de forma atómica entre instancias. */
export async function consumeLoginAttempt(key: string, nowMs = Date.now()): Promise<RateLimitDecision> {
  try {
    const firestore = getFirestore(getAuthApp(), getAccessListDatabaseId());
    const document = firestore.collection(LOGIN_RATE_LIMIT_COLLECTION).doc(key);

    const state = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(document);
      const attempts = validAttempts(snapshot.data()?.attempts, nowMs - LOGIN_RATE_LIMIT_WINDOW_MS);
      const next = nextAttemptState(attempts, nowMs);

      if (next.allowed) {
        transaction.set(document, {
          attempts: next.attempts.map((timestamp) => Timestamp.fromMillis(timestamp)),
          expires_at: Timestamp.fromMillis(nowMs + LOGIN_RATE_LIMIT_RETENTION_MS),
          updated_at: Timestamp.fromMillis(nowMs)
        });
      }

      return next;
    });

    return { ...state, usedFallback: false };
  } catch {
    return consumeFallback(key, nowMs);
  }
}

/** Un login correcto elimina los fallos acumulados de esa IP. */
export async function resetLoginAttempts(key: string): Promise<{ usedFallback: boolean }> {
  fallbackAttempts.delete(key);

  try {
    const firestore = getFirestore(getAuthApp(), getAccessListDatabaseId());
    await firestore.collection(LOGIN_RATE_LIMIT_COLLECTION).doc(key).delete();
    return { usedFallback: false };
  } catch {
    return { usedFallback: true };
  }
}
