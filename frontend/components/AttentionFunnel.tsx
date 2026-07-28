"use client";

// frontend/components/AttentionFunnel.tsx
//
// The strip between the two attention boards (ADR-0146): observation
// narrowing into commitment. Narratives are tracked → some are watched by
// nothing → some of those accelerate (emerging) → a promoted few become
// anchor themes with instruments and a seat in the candidate pool.
//
// Honesty rule inherited from the boards: while no phrase has a measurable
// velocity, the emerging stage reads "—" with the reason, never "0" — in that
// state zero means "cannot say" (ADR-0066), and the funnel must not imply the
// detector looked and found nothing.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  attentionFunnel,
  fetchNarratives,
  toSeries,
  type AttentionFunnelCounts,
} from "@/lib/narratives";

interface ThemeCounts {
  anchors: number;
  promoted: number;
}

function Stage({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="num text-[13px] text-text-primary">{value}</span>
      <span className="text-[11px] text-text-secondary">{label}</span>
    </span>
  );
}

function Arrow() {
  return (
    <span aria-hidden="true" className="text-text-tertiary text-[11px] px-1">
      →
    </span>
  );
}

export default function AttentionFunnel() {
  const [funnel, setFunnel] = useState<AttentionFunnelCounts | null>(null);
  const [themes, setThemes] = useState<ThemeCounts | null>(null);

  useEffect(() => {
    fetchNarratives().then(({ rows, error }) => {
      if (!error) setFunnel(attentionFunnel(toSeries(rows)));
    });
    supabase
      .from("themes")
      .select("id, promotion_basis")
      .then(({ data, error }) => {
        if (error || !data) return;
        setThemes({
          anchors: data.length,
          promoted: data.filter((t) =>
            ["operator_directed", "measured_discovery"].includes(
              (t as { promotion_basis?: string }).promotion_basis ?? "",
            ),
          ).length,
        });
      });
  }, []);

  if (funnel === null && themes === null) return null;

  return (
    <div className="card px-4 py-2.5 flex flex-wrap items-baseline gap-y-1">
      {funnel && (
        <>
          <Stage value={String(funnel.tracked)} label="phrases tracked" />
          <Arrow />
          <Stage value={String(funnel.unwatched)} label="watched by nothing" />
          <Arrow />
          {funnel.velocityMeasurable ? (
            <Stage value={String(funnel.emerging)} label="emerging" />
          ) : (
            <Stage value="—" label="emerging (velocity not measurable yet)" />
          )}
        </>
      )}
      {funnel && themes && <Arrow />}
      {themes && (
        <>
          <Stage value={String(themes.anchors)} label="anchor themes" />
          {themes.promoted > 0 && (
            <>
              <span aria-hidden="true" className="text-text-tertiary text-[11px] px-1">
                ·
              </span>
              <Stage value={String(themes.promoted)} label="promoted from a signal" />
            </>
          )}
        </>
      )}
      <span className="ml-auto text-[10.5px] text-text-tertiary">
        observation narrowing into commitment
      </span>
    </div>
  );
}
