"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TradeIdeasTable from "@/components/TradeIdeasTable";
import LensSelector, { Lens } from "@/components/LensSelector";

export default function TradesPage() {
  return (
    <Suspense fallback={<main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20"><div className="skeleton h-[180px]" /></main>}>
      <TradesPageInner />
    </Suspense>
  );
}

function TradesPageInner() {
  const searchParams = useSearchParams();
  const rawLens = searchParams?.get("lens");
  const validLenses: Lens[] = ["multi_asset", "credit", "rates", "equity", "fx", "commodity"];
  const lens: Lens = (validLenses as string[]).includes(rawLens ?? "")
    ? (rawLens as Lens)
    : "multi_asset";

  return (
    <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
      <div className="flex justify-between items-end mb-7 gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">Trade Ideas</h1>
          <p className="m-0 text-text-secondary text-[13px]">
            Ranked by TradeScore · top 5 longs and top 5 shorts by conviction.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LensSelector value={lens} onChange={() => undefined} />
          <div className="text-right text-text-secondary text-[12px]">
            <div>
              <span className="text-text-tertiary mr-1.5">UNIVERSE</span>
              <span className="num">12 themes · 32 tickers</span>
            </div>
            <div className="mt-1">
              <span className="text-text-tertiary mr-1.5">HYPE THRESHOLD</span>
              <span className="num">≥ 50</span>
            </div>
          </div>
        </div>
      </div>
      <TradeIdeasTable initialLens={lens} />
    </main>
  );
}
