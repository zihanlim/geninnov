"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Would you get the same book twice?
 *
 * `/book`'s turnover panel measures day-over-day churn, and that number conflates two
 * different things: the market moved, and the agent changed its mind. Only the second
 * is a credibility problem, and no amount of staring at day-over-day turnover
 * separates them.
 *
 * `scripts/replication_test.py` separates them. It builds the L5 state once through
 * the deterministic nodes, then calls reason_picks N times on identical deep copies —
 * same candidates, same macro, same regime, same book metrics, same scenarios, same
 * prompt. Everything upstream of the LLM is frozen by construction, so whatever
 * differs is the model.
 *
 * The result is reported without a verdict, like turnover. A book that varies when
 * ten independent ideas compete for five slots is not obviously broken; a book that
 * varies when the pool exactly fills it would be. The panel shows the per-side
 * numbers beside the idea counts so the reader can tell which case they are looking
 * at, and names which positions survived every sample.
 */

interface Row {
  metric_name: string;
  realized_value: number | null;
  end_date: string;
  notes: string | null;
}

interface Parsed {
  samples: number;
  stable: string[];
  unstable: string[];
  longIdeas: number | null;
  shortIdeas: number | null;
}

const fmtPct = (v: number | null) =>
  v === null || Number.isNaN(v) ? "—" : `${Math.round(v * 100)}%`;

/** Strip the L:/S: prefix the harness uses for signed names. */
const pretty = (n: string) => n.replace(/^([LS]):/, (_m, s) => (s === "S" ? "short " : "long "));

export default function Replication() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("backtest_results")
      .select("metric_name, realized_value, end_date, notes")
      .eq("test_name", "book_replication")
      .order("end_date", { ascending: false })
      .limit(12)
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setRows((data ?? []) as Row[]);
      });
  }, []);

  if (error) {
    return (
      <div className="card mb-6 p-[18px] text-[12.5px] text-text-secondary">
        Could not read <code className="num">backtest_results</code>: {error}
      </div>
    );
  }
  // Absent is not zero: render nothing until the harness has run.
  if (!rows || rows.length === 0) return null;

  const latest = rows[0].end_date;
  const today = rows.filter((r) => r.end_date === latest);
  const by = (n: string) =>
    today.find((r) => r.metric_name === n)?.realized_value ?? null;

  let meta: Parsed = {
    samples: 0,
    stable: [],
    unstable: [],
    longIdeas: null,
    shortIdeas: null,
  };
  try {
    const n = JSON.parse(today[0]?.notes ?? "{}");
    meta = {
      samples: n.samples ?? 0,
      stable: n.stable_names ?? [],
      unstable: n.unstable_names ?? [],
      longIdeas: n.long_ideas ?? null,
      shortIdeas: n.short_ideas ?? null,
    };
  } catch {
    /* notes is advisory — a parse failure must not blank the numbers */
  }

  const overall = by("turnover_overall");
  const long = by("turnover_long");
  const short = by("turnover_short");

  const Side = ({
    label,
    value,
    ideas,
  }: {
    label: string;
    value: number | null;
    ideas: number | null;
  }) => (
    <div>
      <div className="num text-[19px] font-semibold leading-[1.15]">
        {fmtPct(value)}
      </div>
      <div className="text-[11px] text-text-tertiary leading-[1.4]">
        {label}
        {ideas !== null && (
          <>
            {" "}
            · <span className="num">{ideas}</span> idea{ideas === 1 ? "" : "s"} for 5
            slots
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="card mb-6">
      <div className="card-header">
        <span className="card-title">
          Same inputs, run again — how much of the book changes
        </span>
        <span className="num text-[11px] text-text-tertiary">
          {meta.samples} samples · {latest}
        </span>
      </div>

      <div className="px-[18px] py-3.5">
        <div className="flex flex-wrap gap-x-8 gap-y-3 mb-3">
          <Side label="whole book" value={overall} ideas={null} />
          <Side label="long side" value={long} ideas={meta.longIdeas} />
          <Side label="short side" value={short} ideas={meta.shortIdeas} />
        </div>

        <p className="m-0 mb-2 text-[12.5px] text-text-secondary leading-[1.6] max-w-[92ch]">
          The turnover panel above measures day-over-day change, which mixes{" "}
          <em>the market moved</em> with <em>the agent changed its mind</em>. This
          separates them: the L5 state is built once and the reasoning step re-run{" "}
          <span className="num">{meta.samples}</span> times on identical copies — same
          candidates, macro, regime, book metrics, scenarios and prompt. Whatever
          differs is the model, not the market.
        </p>

        {meta.stable.length > 0 && (
          <p className="m-0 text-[12px] leading-[1.65] max-w-[92ch]">
            <span className="text-text-tertiary">In every sample — </span>
            <span className="num">{meta.stable.map(pretty).join(", ")}</span>
          </p>
        )}
        {meta.unstable.length > 0 && (
          <p className="m-0 mt-0.5 text-[12px] leading-[1.65] max-w-[92ch]">
            <span className="text-text-tertiary">In some but not all — </span>
            <span className="num" style={{ color: "var(--warning)" }}>
              {meta.unstable.map(pretty).join(", ")}
            </span>
          </p>
        )}

        <p className="m-0 mt-2.5 text-[11px] text-text-tertiary leading-[1.5] max-w-[92ch]">
          No verdict is attached. A side where many independent ideas compete for five
          slots can reasonably return different names each time; a side where the pool
          exactly fills the book should not. The idea counts are shown beside each
          figure so the two cases are told apart rather than averaged.
          Harness: <code className="num">scripts/replication_test.py</code>.
        </p>
      </div>
    </div>
  );
}
