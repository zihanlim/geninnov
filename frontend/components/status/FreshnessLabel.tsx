// frontend/components/status/FreshnessLabel.tsx
import { formatFreshnessAge } from "@/lib/derivations/format";

/**
 * "Updated 4h ago" — and, when the caller can say WHEN, a machine-readable
 * instant behind it.
 *
 * A relative age alone is a number no reader can resolve, no script can parse and
 * assistive tech reads as prose. `<time datetime>` fixes all three for zero pixels,
 * which is why it is here rather than on a backlog.
 *
 * `observed_at` is OPTIONAL and deliberately not derived from `Date.now()` inside
 * this component. An instant computed at render is a different instant on the
 * server than in the browser, so it would both hydrate-mismatch and quietly invent
 * precision the caller never supplied. Callers that hold the real timestamp pass
 * it; callers that only hold an age render exactly as before. Absence stays absent
 * (Goal 2) instead of being filled with a plausible guess.
 *
 * The title is formatted in UTC, not via toLocaleString: the pipeline publishes on
 * a UTC schedule, and a locale-formatted string is another server/client mismatch.
 */
export function FreshnessLabel({
  observed_age_seconds,
  observed_at,
}: {
  observed_age_seconds: number;
  /** ISO-8601 instant the age was measured against, when the caller has it. */
  observed_at?: string | null;
}) {
  const age = formatFreshnessAge(observed_age_seconds);

  if (!observed_at) {
    return (
      <span className="text-xs text-text-secondary">Updated {age} ago</span>
    );
  }

  const parsed = new Date(observed_at);
  // An unparseable timestamp must not emit an invalid `datetime` attribute; fall
  // back to the plain span rather than shipping a broken one.
  if (Number.isNaN(parsed.getTime())) {
    return (
      <span className="text-xs text-text-secondary">Updated {age} ago</span>
    );
  }

  return (
    <span className="text-xs text-text-secondary">
      Updated{" "}
      <time dateTime={parsed.toISOString()} title={formatUtcStamp(parsed)}>
        {age}
      </time>{" "}
      ago
    </span>
  );
}

/** "26 Jul 2026, 21:30 UTC" — deterministic on server and client. */
function formatUtcStamp(d: Date): string {
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}
