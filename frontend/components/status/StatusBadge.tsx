// frontend/components/status/StatusBadge.tsx
import type { NumericStatus } from "@/lib/derivations/numeric";
import { STATUS_CHIPS } from "@/lib/statusChips";

export function StatusBadge({ status }: { status: NumericStatus }) {
  const { text, cls } = STATUS_CHIPS[status];
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}
      aria-label={text}
    >
      {text}
    </span>
  );
}
