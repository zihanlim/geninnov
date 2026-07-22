// frontend/components/status/FreshnessLabel.tsx
import { formatFreshnessAge } from "@/lib/derivations/format";

export function FreshnessLabel({
  observed_age_seconds,
}: {
  observed_age_seconds: number;
}) {
  return (
    <span className="text-xs text-text-secondary">
      Updated {formatFreshnessAge(observed_age_seconds)} ago
    </span>
  );
}
