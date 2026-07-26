// frontend/lib/chat/db.ts
//
// The server-side halves of /ask's database access, kept apart on purpose:
//
//   readerClient  — the ANON key, reading the same public-read tables the
//                   browser already reads. The agent can therefore reveal
//                   nothing a visitor could not have fetched themselves.
//   guardClient   — the SERVICE key, used for exactly one call: the rate-limit
//                   RPC. Nothing else in this codebase may use it.
//
// Splitting them is not ceremony. The service key bypasses RLS entirely, so the
// blast radius of a mistake made with it is the whole database; the reader
// client makes that mistake impossible for the 99% of the code that only needs
// to read published rows.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DbReader } from "./types";

/**
 * Fail loudly if a server-only module is ever pulled into a client bundle.
 *
 * Next.js already keeps a non-NEXT_PUBLIC env var out of the browser, so the key
 * itself cannot leak this way — but a component importing this file would get a
 * silently keyless client and a mysterious empty answer. Better to break.
 */
function assertServer(what: string) {
  if (typeof window !== "undefined") {
    throw new Error(`${what} is server-only and was imported into client code.`);
  }
}

let reader: SupabaseClient | null = null;

export function readerClient(): SupabaseClient {
  assertServer("lib/chat/db");
  if (!reader) {
    reader = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
      { auth: { persistSession: false } },
    );
  }
  return reader;
}

export function guardClient(): SupabaseClient | null {
  assertServer("lib/chat/db");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * The DbReader the tools receive.
 *
 * Errors are returned, never thrown: a tool's job when a table is unreadable is
 * to state the absence, and an exception here would instead produce a 500 and
 * tell the reader nothing.
 */
export function supabaseReader(client: SupabaseClient = readerClient()): DbReader {
  return {
    async select(table, columns, opts) {
      let q = client.from(table).select(columns);
      for (const [col, val] of Object.entries(opts?.eq ?? {})) q = q.eq(col, val);
      if (opts?.order) q = q.order(opts.order.column, { ascending: opts.order.ascending ?? false });
      if (opts?.limit) q = q.limit(opts.limit);
      const { data, error } = await q;
      return {
        rows: (data ?? []) as unknown as Record<string, unknown>[],
        error: error ? error.message : null,
      };
    },
  };
}
