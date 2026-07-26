// frontend/lib/chat/rateLimit.ts
//
// The spend guard, client side of migration 039.
//
// FAIL CLOSED. Every branch that cannot prove the request is within budget
// refuses it. That is the opposite of the usual availability instinct, and it is
// correct here: the thing being protected is not a server, it is the MiniMax
// quota that tomorrow morning's L5 book runs on. A rate limiter that lets
// traffic through when it is broken protects nothing on the day it matters.
//
// The one exception is local development, where neither key exists and the
// alternative is a feature nobody can run. It is gated on NODE_ENV — which
// Vercel sets to "production" — and it announces itself in the log.

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RateVerdict {
  allowed: boolean;
  /** Reader-facing sentence when refused. */
  message?: string;
  used?: number;
  cap?: number;
}

const PER_IP_CAP = Number(process.env.CHAT_PER_IP_DAILY_CAP || 15);
const GLOBAL_CAP = Number(process.env.CHAT_GLOBAL_DAILY_CAP || 200);

/**
 * Identify a caller without storing who they are.
 *
 * Salted: an unsalted SHA-256 of an IPv4 address is reversible by brute force in
 * seconds — there are only four billion of them — so the hash alone would be a
 * lightly obfuscated address rather than an anonymous one.
 */
export function hashIp(ip: string): string {
  const salt = process.env.CHAT_IP_SALT || "andromeda-ask";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/** Vercel puts the real client first in x-forwarded-for; everything after is proxies. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export async function checkRateLimit(
  guard: SupabaseClient | null,
  ip: string,
): Promise<RateVerdict> {
  if (!guard) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[ask] No SUPABASE_SERVICE_KEY — rate limiting is OFF (development only).");
      return { allowed: true };
    }
    return {
      allowed: false,
      message:
        "The spend guard is not configured, so /ask is closed. Set SUPABASE_SERVICE_KEY and apply migration 039.",
    };
  }

  const { data, error } = await guard.rpc("chat_rate_limit", {
    p_ip_hash: hashIp(ip),
    p_per_ip_cap: PER_IP_CAP,
    p_global_cap: GLOBAL_CAP,
  });

  if (error) {
    // Most likely cause: migration 039 has not been applied to this project. Say
    // so, because "try again later" would send someone hunting for an outage.
    return {
      allowed: false,
      message: `The spend guard could not be reached (${error.message}), so /ask is closed. If this is a fresh deployment, apply supabase/migrations/039_chat_usage.sql.`,
    };
  }

  const verdict = (data ?? {}) as {
    allowed?: boolean;
    reason?: string;
    used?: number;
    per_ip_cap?: number;
    global_used?: number;
    global_cap?: number;
  };

  if (verdict.allowed) {
    return { allowed: true, used: verdict.used, cap: verdict.per_ip_cap };
  }
  return {
    allowed: false,
    used: verdict.used,
    cap: verdict.per_ip_cap,
    message:
      verdict.reason === "global"
        ? `/ask has used its whole allowance for today (${verdict.global_used ?? "?"} of ${verdict.global_cap ?? "?"} questions). It shares an LLM quota with the nightly book, which takes priority. The book itself is on /book and needs no quota to read.`
        : `You have asked ${verdict.used ?? "?"} questions today, which is the daily limit of ${verdict.per_ip_cap ?? "?"} per visitor. Everything the agent reads is on /book, /risk and /method without a limit.`,
  };
}
