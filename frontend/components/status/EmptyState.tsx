// frontend/components/status/EmptyState.tsx
//
// Every empty state in this product must answer two questions a portfolio
// manager will otherwise ask out loud: WHY is there nothing here, and WHAT
// would change it. Generic strings like "No positions." fail both — they leave
// a broken pipeline, a quiet market, and a mis-set threshold indistinguishable.
//
// The `cause` is what the data says. The `remedy` is the operator action. The
// `source` names the table/column so the claim is checkable.

interface Props {
  /** Short statement of what is absent. */
  title: string;
  /** Why it is absent — grounded in observed data, not a guess. */
  cause: string;
  /** What would populate it. */
  remedy?: string;
  /** Table/column or module this surface reads from. */
  source?: string;
  /** Set when the emptiness is a fault rather than a legitimate outcome. */
  severity?: "info" | "warning" | "error";
  compact?: boolean;
}

const ACCENT: Record<NonNullable<Props["severity"]>, string> = {
  info: "var(--border-strong)",
  warning: "var(--warning)",
  error: "var(--short)",
};

export function EmptyState({
  title,
  cause,
  remedy,
  source,
  severity = "info",
  compact = false,
}: Props) {
  return (
    <div
      className={`text-center ${compact ? "p-6" : "p-12"}`}
      data-testid="empty-state"
      role="status"
    >
      <div
        className="mx-auto max-w-[560px] rounded-[8px] border px-5 py-4 text-left"
        style={{
          borderColor: ACCENT[severity],
          background: "var(--bg-elevated)",
        }}
      >
        <div className="text-[13px] font-semibold text-text-primary mb-1.5">
          {title}
        </div>
        <p className="m-0 text-[12.5px] leading-[1.65] text-text-secondary">
          {cause}
        </p>
        {remedy && (
          <p className="mt-2 mb-0 text-[12.5px] leading-[1.65] text-text-secondary">
            <span className="text-text-tertiary uppercase tracking-[0.1em] text-[10.5px] mr-1.5">
              Next
            </span>
            {remedy}
          </p>
        )}
        {source && (
          <div className="mt-2.5 pt-2.5 border-t border-border text-[11px] text-text-tertiary">
            Source: <code className="num">{source}</code>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Empty state for a failed query. A 400/404 from PostgREST means a column or
 * table the frontend expects does not exist — rendering that as "no data" is how
 * three schema mismatches survived in production unnoticed. Show it.
 */
export function QueryErrorState({
  what,
  message,
  source,
}: {
  what: string;
  message: string;
  source?: string;
}) {
  return (
    <EmptyState
      title={`${what} could not be loaded`}
      cause={`The database rejected this query: "${message}". This is a schema mismatch, not an absence of data — the UI is asking for something that does not exist.`}
      remedy="Check the column list against the latest migration, then reconcile the query or add the column."
      source={source}
      severity="error"
    />
  );
}
