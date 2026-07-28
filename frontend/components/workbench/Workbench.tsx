"use client";

// The workbench: the published book as a starting point you can edit.
//
// THE ONE THING THIS MUST NEVER DO is look like the book. Every figure here is a
// browser-side estimate over an edited copy; none of it is published, none of it
// traces to a persisted row, and a reader who confuses the two has been given a
// number with no provenance (design goal 1). Hence the banner, the "EST" markers,
// and the deliberate refusal to reuse the book's row chrome.
//
// It changes nothing. Design goal 5's test — "name what that path can change;
// 'nothing in the book' is the only acceptable answer" — passes because the edit
// path is a `useState` call and the persistence is `localStorage`. The server never
// learns a scratch portfolio exists.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ENFORCED } from "@/lib/mandate";
import {
  driftFromBook,
  scratchMetrics,
  scratchNotionals,
  type ScratchPosition,
  type Tier,
} from "@/lib/workbench/scratch";

const STORAGE_KEY = "andromeda.workbench.v1";

const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;
const usd = (v: number) =>
  `${v < 0 ? "-" : ""}$${(Math.abs(v) / 1_000_000).toFixed(1)}M`;

export interface WorkbenchSeed {
  asset: string;
  direction: "long" | "short";
  weight: number;
  tier: Tier;
  edgeScore: number | null;
  conviction: number | null;
  vol: number | null;
  sector: string | null;
  geo: string | null;
}

const TIER_LABEL: Record<Tier, string> = {
  held: "in the book",
  candidate: "cleared, not taken",
  unscored: "not scored",
};

export default function Workbench({
  seed,
  candidates,
  published,
}: {
  seed: WorkbenchSeed[];
  candidates: WorkbenchSeed[];
  published: { asset: string; direction: "long" | "short"; weight?: number }[];
}) {
  const [positions, setPositions] = useState<ScratchPosition[]>(seed);
  const [restored, setRestored] = useState(false);
  const [ticker, setTicker] = useState("");

  // localStorage only. No account, no user_id, no server write — the reason this
  // whole surface clears design goal 5 without an argument.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ScratchPosition[];
        if (Array.isArray(parsed) && parsed.length) {
          setPositions(parsed);
          setRestored(true);
        }
      }
    } catch {
      /* a corrupt entry must not blank the page — fall through to the seed */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
    } catch {
      /* quota or private mode; the workbench still works for this session */
    }
  }, [positions]);

  const metrics = useMemo(() => scratchMetrics(positions), [positions]);
  const notionals = useMemo(() => scratchNotionals(positions), [positions]);
  const drift = useMemo(() => driftFromBook(positions, published), [positions, published]);

  const setWeight = useCallback((asset: string, weight: number) => {
    setPositions((prev) =>
      prev.map((p) => (p.asset === asset ? { ...p, weight: Math.max(0, weight) } : p)),
    );
  }, []);

  const flip = useCallback((asset: string) => {
    setPositions((prev) =>
      prev.map((p) =>
        p.asset === asset
          ? { ...p, direction: p.direction === "long" ? "short" : "long" }
          : p,
      ),
    );
  }, []);

  const remove = useCallback((asset: string) => {
    setPositions((prev) => prev.filter((p) => p.asset !== asset));
  }, []);

  const add = useCallback(
    (row: WorkbenchSeed) => {
      setPositions((prev) =>
        prev.some((p) => p.asset === row.asset) ? prev : [...prev, { ...row }],
      );
    },
    [],
  );

  const addTyped = useCallback(() => {
    const symbol = ticker.trim().toUpperCase();
    if (!symbol) return;
    const known = candidates.find((c) => c.asset === symbol);
    add(
      known ?? {
        asset: symbol,
        direction: "long",
        weight: 0.05,
        tier: "unscored",
        // Null, never 0. A conviction of 0 would read as "measured, and it is
        // nothing" — a different and false claim (design goal 2).
        edgeScore: null,
        conviction: null,
        vol: null,
        sector: null,
        geo: null,
      },
    );
    setTicker("");
  }, [ticker, candidates, add]);

  const reset = useCallback(() => {
    setPositions(seed);
    setRestored(false);
  }, [seed]);

  const notInBook = candidates.filter((c) => !positions.some((p) => p.asset === c.asset));

  return (
    <div className="space-y-5">
      {/* Nothing here is published. Said once, prominently, before any figure. */}
      <div
        className="rounded-[10px] border px-4 py-3 text-[13px] leading-[1.6]"
        style={{ borderColor: "var(--border-strong)", background: "var(--bg-elevated)" }}
        role="note"
      >
        <span className="font-semibold text-text-primary">
          This is your copy, not the book.{" "}
        </span>
        <span className="text-text-secondary">
          Every figure below is computed in your browser over an edited portfolio.
          None of it is published, none of it traces to a stored row, and nothing you
          do here changes the{" "}
          <Link href="/book" className="text-accent hover:underline">
            published book
          </Link>
          . It is kept in this browser only — it will not follow you to another device.
          {restored && " Restored from your last session."}
        </span>
      </div>

      {/* ── What you changed ──────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Distance from the published book</span>
          <span className="text-[11px] text-text-tertiary">
            {drift.turnover === 0 ? "unchanged" : `${pct(drift.turnover)} of capital moved`}
          </span>
        </div>
        <div className="card-body grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12.5px]">
          {[
            ["Added", drift.added],
            ["Removed", drift.removed],
            ["Resized", drift.resized],
          ].map(([label, names]) => (
            <div key={label as string}>
              <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-semibold mb-1">
                {label as string}
              </div>
              <div className="num text-text-primary">
                {(names as string[]).length ? (names as string[]).join(", ") : "—"}
              </div>
            </div>
          ))}
          <div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-semibold mb-1">
              Turnover
            </div>
            <div className="num text-text-primary">{pct(drift.turnover)}</div>
          </div>
        </div>
      </div>

      {/* ── Exposures ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 bg-bg-surface border border-border rounded-[8px] overflow-hidden divide-y md:divide-y-0 md:divide-x divide-border">
        {[
          ["Positions", String(positions.length), "names in your copy"],
          ["Gross", pct(metrics.gross), `of a ${pct(ENFORCED.gross_exposure_pct.value, 0)} budget`],
          ["Net", `${metrics.net >= 0 ? "+" : ""}${pct(metrics.net)}`, "long − short"],
          ["Deployed", usd(metrics.deployed * ENFORCED.total_capital.value), `of ${usd(ENFORCED.total_capital.value)}`],
          ["Cash", usd(metrics.cash * ENFORCED.total_capital.value), "undeployed"],
          ["HHI", metrics.hhi.toFixed(0), "0–10 000 scale"],
        ].map(([label, value, hint]) => (
          <div key={label} className="px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-semibold leading-none mb-1">
              {label}
            </div>
            <div className="num text-[16px] font-semibold leading-[1.1] text-text-primary">
              {value}
            </div>
            <div className="text-[10.5px] text-text-secondary mt-1 leading-[1.35]">{hint}</div>
          </div>
        ))}
      </div>

      {metrics.breaches.length > 0 && (
        <div
          role="alert"
          className="rounded-[10px] border px-4 py-3 text-[13px] leading-[1.6]"
          style={{ borderColor: "var(--warning)", background: "rgba(168, 50, 9, 0.08)" }}
        >
          <span className="font-semibold" style={{ color: "var(--warning)" }}>
            Over the mandate —{" "}
          </span>
          <span className="text-text-secondary">
            {metrics.breaches.join(", ")}. The published book cannot breach these; your
            copy can, which is what makes it useful for asking what a limit costs. See{" "}
            <Link href="/risk#mandate" className="text-accent hover:underline">
              the mandate
            </Link>
            .
          </span>
        </div>
      )}

      {/* ── Positions ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Your positions</span>
          <button
            onClick={reset}
            className="text-[11px] text-text-tertiary hover:text-text-secondary underline"
          >
            Reset to the published book
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">
              Editable scratch portfolio with per-name weight, side and signal.
            </caption>
            <thead>
              <tr>
                {["Name", "Side", "Weight", "Notional", "Edge", "Conviction", ""].map((h, i) => (
                  <th
                    key={h || i}
                    className={`px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-border bg-bg-elevated ${
                      i >= 2 && i <= 5 ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.asset}>
                  <td className="px-3 py-2 border-b border-border">
                    <span className="num font-medium text-text-primary">{p.asset}</span>
                    <span className="ml-2 text-[10.5px] text-text-tertiary">
                      {TIER_LABEL[p.tier]}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b border-border">
                    {/* Glyph AND wordmark, never hue alone (design goal 3). */}
                    <button
                      onClick={() => flip(p.asset)}
                      className="text-[12px] hover:underline"
                      style={{ color: p.direction === "long" ? "var(--long)" : "var(--short)" }}
                      aria-label={`Flip ${p.asset} to ${p.direction === "long" ? "short" : "long"}`}
                    >
                      {p.direction === "long" ? "▲ LONG" : "▼ SHORT"}
                    </button>
                  </td>
                  <td className="px-3 py-2 border-b border-border text-right">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={(p.weight * 100).toFixed(1)}
                      onChange={(e) => setWeight(p.asset, Number(e.target.value) / 100)}
                      aria-label={`${p.asset} weight, percent of capital`}
                      className="num w-20 text-right bg-bg-elevated border border-border rounded px-2 py-1 text-[12.5px]"
                    />
                  </td>
                  <td className="px-3 py-2 border-b border-border text-right num text-text-secondary">
                    {usd(notionals[p.asset] ?? 0)}
                  </td>
                  <td className="px-3 py-2 border-b border-border text-right num">
                    {p.edgeScore === null ? (
                      <span
                        className="text-text-tertiary"
                        title="Not scored: an EdgeScore needs a theme, news mentions and a HypeScore, which this name has none of."
                      >
                        not scored
                      </span>
                    ) : (
                      p.edgeScore.toFixed(2)
                    )}
                  </td>
                  <td className="px-3 py-2 border-b border-border text-right num">
                    {p.conviction === null ? (
                      <span className="text-text-tertiary">—</span>
                    ) : (
                      `${p.conviction.toFixed(1)}×`
                    )}
                  </td>
                  <td className="px-3 py-2 border-b border-border text-right">
                    <button
                      onClick={() => remove(p.asset)}
                      className="text-[11px] text-text-tertiary hover:text-warning"
                      aria-label={`Remove ${p.asset}`}
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
              {positions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-text-tertiary text-[12.5px]">
                    Empty. Add a name below, or reset to the published book.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {metrics.unscored.length > 0 && (
          <p className="m-0 px-4 py-3 text-[11.5px] text-text-tertiary leading-[1.6] border-t border-border">
            <span className="num">{metrics.unscored.join(", ")}</span>{" "}
            {metrics.unscored.length === 1 ? "is" : "are"} not in the candidate pool, so
            Andromeda has no EdgeScore or conviction for{" "}
            {metrics.unscored.length === 1 ? "it" : "them"} — those need a theme, news
            mentions and a HypeScore. That is an absence, not a zero. Exposure and cap
            usage still count{" "}
            {metrics.unscored.length === 1 ? "it" : "them"} in full.
          </p>
        )}
      </div>

      {/* ── Add ───────────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Add a name</span>
          <span className="text-[11px] text-text-tertiary">
            any ticker; scored names bring their signal
          </span>
        </div>
        <div className="card-body">
          <div className="flex gap-2 mb-4">
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTyped()}
              placeholder="Ticker, e.g. NVDA"
              aria-label="Ticker to add"
              className="num flex-1 max-w-[220px] bg-bg-elevated border border-border rounded px-3 py-1.5 text-[13px]"
            />
            <button
              onClick={addTyped}
              className="px-3 py-1.5 rounded border border-border text-[12.5px] font-medium hover:bg-bg-elevated"
            >
              Add
            </button>
          </div>

          {notInBook.length > 0 && (
            <>
              <div className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary font-semibold mb-2">
                Cleared the screen, not taken
              </div>
              <div className="flex flex-wrap gap-2">
                {notInBook.slice(0, 24).map((c) => (
                  <button
                    key={c.asset}
                    onClick={() => add(c)}
                    className="px-2 py-1 rounded border border-border text-[12px] hover:bg-bg-elevated"
                    title={`${c.direction} · EdgeScore ${c.edgeScore?.toFixed(2) ?? "—"}`}
                  >
                    <span className="num">{c.asset}</span>
                    <span className="ml-1.5 text-text-tertiary">
                      {c.direction === "long" ? "▲" : "▼"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
