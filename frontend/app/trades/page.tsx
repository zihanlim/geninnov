import TradeIdeasTable from "@/components/TradeIdeasTable";

export default function TradesPage() {
  return (
    <main className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-6">
      <h1 className="text-2xl font-mono font-bold mb-6">Trade Ideas</h1>
      <TradeIdeasTable />
    </main>
  );
}
