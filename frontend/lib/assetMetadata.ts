// Asset taxonomy mirror of backend/services/trade_ranker.py:classify.
// The DB-side taxonomy lives in supabase/migrations/009_asset_class_lens.sql
// (theme_assets.asset_class). On the frontend we receive a hydrated
// `AssetMeta[]` row set and resolve lookups locally — no silent fallback:
// unmapped tickers throw so callers can surface a clear error.

export type AssetClass =
  | "rates"
  | "credit"
  | "equity"
  | "fx"
  | "commodity"
  | "crypto"
  | "other";

export interface AssetMeta {
  ticker: string;
  sector: string;
  geo: string;
  asset_class: AssetClass;
}

export function classify(ticker: string, table: AssetMeta[]): AssetMeta {
  const row = table.find((r) => r.ticker === ticker);
  if (!row) throw new Error(`unclassified ticker: ${ticker}`);
  return row;
}
