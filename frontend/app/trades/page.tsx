import TradeIdeasTable from "@/components/TradeIdeasTable";

export default function TradesPage() {
  return (
    <main className="max-w-[1320px] mx-auto px-8 pt-7 pb-20">
      <div className="flex justify-between items-end mb-7">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] m-0 mb-1">Trade Ideas</h1>
          <p className="m-0 text-text-secondary text-[13px]">
            Ranked by TradeScore · top 5 longs and top 5 shorts by conviction.
          </p>
        </div>
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
      <TradeIdeasTable />
    </main>
  );
}
