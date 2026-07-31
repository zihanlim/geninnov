"use client";

// /workbench — the published book as a starting point you can edit.
//
// NOT A FIFTH NAV DESTINATION. `docs/design-goals.md` fixes the top bar at four
// destinations, and this is reached from `/book` the same way `/ask` is reached from
// a TopBar control: it is a way of WORKING WITH the book, not a fifth thing the
// product is. If it ever appears in the nav, that decision has been reversed and
// needs re-arguing there.
//
// Everything it renders is a browser-side estimate over an edited copy. The route
// fetches the published book to SEED the copy and then never writes anything —
// design goal 5 holds because there is no write path to hold.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { EmptyState, QueryErrorState } from "@/components/status/EmptyState";
import Workbench, { type WorkbenchSeed } from "@/components/workbench/Workbench";
import type { Pick } from "@/lib/book/types";

interface CandidateRow {
  asset: string;
  direction: "long" | "short";
  edge_score: number | null;
  run_date: string;
}

interface SignalRow {
  asset: string;
  direction: "long" | "short";
  edge_score: number | null;
  conviction: number | null;
  vol: number | null;
  // Instrument identity, carried on the signal so the frontend does not keep a
  // second copy of the sector/geography judgement. ADR-0121/0125 record what
  // happened the last time that map lived in more than one place: a fix landed in
  // two of three copies and missed the one with the consequence.
  sector: string | null;
  geo: string | null;
  run_date: string;
}

export default function WorkbenchPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
          <div className="skeleton h-[200px]" />
        </main>
      }
    >
      <WorkbenchPageInner />
    </Suspense>
  );
}

function WorkbenchPageInner() {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [sectors, setSectors] = useState<Record<string, { sector: string | null; geo: string | null }>>({});
  const [runDate, setRunDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [bookRes, sigRes, candRes] = await Promise.all([
        // Migration 062 keyed this table on (run_date, lens); the workbench seeds
        // from the multi-asset book only, so the read is explicit rather than
        // depending on whichever row Postgres returns first for a run_date that
        // now carries two books.
        supabase
          .from("research_recommendations")
          .select("run_date, picks, book_metrics")
          .eq("lens", "multi_asset")
          .order("run_date", { ascending: false })
          .limit(1),
        supabase
          .from("book_signal")
          .select("asset, direction, edge_score, conviction, vol, sector, geo, run_date")
          .order("run_date", { ascending: false })
          .limit(60),
        supabase
          .from("trade_candidates")
          .select("asset, direction, edge_score, run_date")
          .order("run_date", { ascending: false })
          .limit(120),
      ]);

      if (bookRes.error) {
        setError(bookRes.error.message);
        setLoading(false);
        return;
      }

      const row = bookRes.data?.[0] as
        | { run_date: string; picks: Pick[] | string; book_metrics: unknown }
        | undefined;
      const parsed: Pick[] = Array.isArray(row?.picks)
        ? (row!.picks as Pick[])
        : typeof row?.picks === "string"
          ? (JSON.parse(row.picks) as Pick[])
          : [];
      setPicks(parsed);
      setRunDate(row?.run_date ?? null);

      // Latest vintage only, for both. Mixing run dates would seed the copy with
      // names that were never in the same book.
      const sigRows = (sigRes.data as SignalRow[] | null) ?? [];
      const sigDate = sigRows[0]?.run_date ?? null;
      setSignals(sigRows.filter((r) => r.run_date === sigDate));

      const candRows = (candRes.data as CandidateRow[] | null) ?? [];
      const candDate = candRows[0]?.run_date ?? null;
      setCandidates(candRows.filter((r) => r.run_date === candDate));

      // Sector / geography ride on the signal rows. A name absent from the map is
      // left null and excluded from group caps rather than bucketed into a
      // synthetic "Unknown", which would invent a cap check on a category that
      // does not exist.
      const map: Record<string, { sector: string | null; geo: string | null }> = {};
      for (const r of sigRows) {
        if (r.asset) map[r.asset] = { sector: r.sector ?? null, geo: r.geo ?? null };
      }
      setSectors(map);
      setLoading(false);
    }
    load();
  }, []);

  const signalByAsset = useMemo(
    () => Object.fromEntries(signals.map((s) => [s.asset, s])),
    [signals],
  );

  const seed: WorkbenchSeed[] = useMemo(
    () =>
      picks.map((p) => {
        const s = signalByAsset[p.asset];
        const meta = sectors[p.asset];
        return {
          asset: p.asset,
          direction: p.direction,
          weight: Math.abs(p.weight ?? 0),
          tier: "held" as const,
          edgeScore: s?.edge_score ?? null,
          conviction: s?.conviction ?? null,
          vol: s?.vol ?? null,
          sector: meta?.sector ?? null,
          geo: meta?.geo ?? null,
        };
      }),
    [picks, signalByAsset, sectors],
  );

  const pool: WorkbenchSeed[] = useMemo(() => {
    const held = new Set(picks.map((p) => p.asset));
    return candidates
      .filter((c) => !held.has(c.asset))
      .map((c) => {
        const meta = sectors[c.asset];
        return {
          asset: c.asset,
          direction: c.direction,
          weight: 0.05,
          tier: "candidate" as const,
          edgeScore: c.edge_score ?? null,
          // A candidate has an EdgeScore but no conviction persisted on this table;
          // null rather than a derived guess.
          conviction: null,
          vol: null,
          sector: meta?.sector ?? null,
          geo: meta?.geo ?? null,
        };
      });
  }, [candidates, picks, sectors]);

  return (
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 wide:px-5 pt-7 pb-20">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">Workbench</h1>
        <p className="m-0 text-text-primary text-[14.5px] leading-[1.55]">
          The published book, as something you can edit. Drop a name, resize it, add
          one it passed on — or any ticker at all — and watch the exposures and the
          mandate&rsquo;s caps move.
        </p>
        <p className="m-0 mt-2 text-text-tertiary text-[12px] leading-[1.5]">
          {/* "the MULTI-ASSET book", named. The read twelve lines up is a hardcoded
              `.eq("lens", "multi_asset")` and its comment says so — but the comment
              is not on screen, and this sentence said "the book" as though there
              were one. /book links here saying "edit a copy of this book", so a
              reader arriving from the credit book was handed the 9-name multi-asset
              portfolio to edit. Unconditional, unlike the LiveFeed and RegimeHero
              qualifiers: this page has no lens in its URL to gate on, and the
              ambiguity is in the noun itself. */}
          Seeded from the{" "}
          <Link href="/book" className="text-accent hover:underline">
            multi-asset book
          </Link>{" "}
          published <span className="num">{runDate ?? "—"}</span> — the workbench
          seeds from that book only, whichever lens you came from. Limits come from{" "}
          <Link href="/mandate" className="text-accent hover:underline">
            the mandate
          </Link>
          .
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-[90px]" />
          <div className="skeleton h-[280px]" />
        </div>
      ) : error ? (
        <div className="card">
          <QueryErrorState what="The book" message={error} source="research_recommendations" />
        </div>
      ) : picks.length === 0 ? (
        <div className="card">
          <EmptyState
            title="There is no published book to start from"
            cause="research_recommendations has no rows with picks, so there is nothing to seed a working copy with."
            remedy="Check /method for which pipeline stage last ran."
            source="research_recommendations.picks"
          />
        </div>
      ) : (
        <Workbench
          seed={seed}
          candidates={pool}
          published={picks.map((p) => ({
            asset: p.asset,
            direction: p.direction,
            weight: Math.abs(p.weight ?? 0),
          }))}
        />
      )}
    </main>
  );
}
