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
 * Classify a PostgREST/supabase-js failure so the panel names the RIGHT cause.
 *
 * This used to assert "This is a schema mismatch" for every failure, with a
 * remedy telling the reader to check the column list against the latest
 * migration. That is correct for a 400/404 and actively misleading for anything
 * else — an expired anon key rendered as `Invalid API key … this is a schema
 * mismatch … check the column list`, sending the reader to diff migrations when
 * the problem was a credential. Goal 2 is that absence is *stated*, and a
 * confidently wrong cause is worse than a vague one: it spends the reader's
 * trust and their afternoon.
 *
 * Matched on the message text because supabase-js surfaces the PostgREST body
 * rather than the HTTP status; each arm is keyed to a string PostgREST actually
 * emits.
 */
function classifyQueryFailure(message: string): { cause: string; remedy: string } {
  const m = (message ?? "").toLowerCase();

  if (m.includes("api key") || m.includes("jwt") || m.includes("unauthorized")) {
    return {
      cause: `The database rejected the credential, not the query: "${message}". Nothing can be read until it is replaced — this says nothing about whether the data exists.`,
      remedy:
        "Check NEXT_PUBLIC_SUPABASE_ANON_KEY against the project's current publishable key. A rotated or placeholder key fails every request identically.",
    };
  }

  if (m.includes("row-level security") || m.includes("permission denied") || m.includes("rls")) {
    return {
      cause: `The row is there; this role may not read it: "${message}". A policy refused the request, so an empty result here is a permissions answer and not a data answer.`,
      remedy:
        "Check that a SELECT policy grants the anon role read access to this table, as the other read-only tables have.",
    };
  }

  if (m.includes("fetch") || m.includes("network") || m.includes("timeout")) {
    return {
      cause: `The request never reached the database: "${message}". Whether the data exists is unknown — this is a transport failure, not an answer.`,
      remedy: "Check connectivity to the Supabase host, then reload. Nothing here needs changing if it was a blip.",
    };
  }

  // The original case, now stated only when it is actually true.
  return {
    cause: `The database rejected this query: "${message}". This is a schema mismatch, not an absence of data — the UI is asking for something that does not exist.`,
    remedy:
      "Check the column list against the latest migration, then reconcile the query or add the column.",
  };
}

/**
 * Empty state for a failed query. A 400/404 from PostgREST means a column or
 * table the frontend expects does not exist — rendering that as "no data" is how
 * three schema mismatches survived in production unnoticed. Show it.
 *
 * But show the *right* one: see classifyQueryFailure above.
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
  const { cause, remedy } = classifyQueryFailure(message);
  return (
    <EmptyState
      title={`${what} could not be loaded`}
      cause={cause}
      remedy={remedy}
      source={source}
      severity="error"
    />
  );
}
