// frontend/components/status/UncertaintyBand.tsx
import { formatBand } from "@/lib/derivations/format";

export function UncertaintyBand({
  low,
  high,
}: {
  low?: number;
  high?: number;
}) {
  if (low == null || high == null) return null;
  return (
    <span className="text-xs text-text-secondary">
      ± range {formatBand(low, high)}
    </span>
  );
}
