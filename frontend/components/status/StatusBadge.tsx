// frontend/components/status/StatusBadge.tsx
import type { NumericStatus } from "@/lib/derivations/numeric";

const labels: Record<NumericStatus, { text: string; cls: string }> = {
  exact: { text: "Exact", cls: "bg-long-dim text-long" },
  estimated: { text: "Estimated", cls: "bg-warning-dim text-warning" },
  stale: { text: "Stale", cls: "bg-[#3a2615] text-[#f0883e]" },
  unavailable: { text: "Unavailable", cls: "bg-bg-elevated text-text-secondary border border-border" },
  unverified: { text: "Unverified", cls: "bg-short-dim text-short" },
};

export function StatusBadge({ status }: { status: NumericStatus }) {
  const { text, cls } = labels[status];
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}
      aria-label={text}
    >
      {text}
    </span>
  );
}
