"use client";

/**
 * LensSelector — segmented control for filtering the book by asset class.
 * Mirrors the backend L5 lens parameter (see ADR-0015):
 *   multi_asset  → all asset classes (default)
 *   credit       → credit + rates (HYG, LQD, TLT, IEF, EMB, etc.)
 *   rates        → rates only (TLT, IEF, TIPS, AGG, etc.)
 *   equity       → equity ETFs
 *   fx           → currency instruments
 *   commodity    → commodities
 *
 * Pure UI component — emits the selected lens via onChange. Pages handle the
 * actual data fetch (filter Supabase query by asset_class column from migration 009).
 */

export type Lens = "multi_asset" | "credit" | "rates" | "equity" | "fx" | "commodity";

interface LensOption {
  value: Lens;
  label: string;
  description: string;
}

const LENS_OPTIONS: LensOption[] = [
  { value: "multi_asset", label: "Multi-Asset", description: "Default · all asset classes" },
  { value: "credit", label: "Credit Lens", description: "Credit + rates only" },
  { value: "rates", label: "Rates Only", description: "Duration & curve trades" },
  { value: "equity", label: "Equity", description: "Sector / index ETFs" },
  { value: "fx", label: "FX", description: "Currencies" },
  { value: "commodity", label: "Commodity", description: "Metals / energy" },
];

export default function LensSelector({
  value,
  onChange,
}: {
  value: Lens;
  onChange: (lens: Lens) => void;
}) {
  const activeLabel = LENS_OPTIONS.find((opt) => opt.value === value)?.label ?? value;
  return (
    <div className="inline-flex items-stretch rounded-md border border-border bg-bg-elevated overflow-hidden">
      <span data-testid="lens-active" className="sr-only">
        {activeLabel}
      </span>
      {LENS_OPTIONS.map((opt, idx) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={[
              "px-3 py-1.5 text-[12px] font-medium transition-colors",
              idx > 0 ? "border-l border-border" : "",
              isActive
                ? "bg-accent text-bg-primary"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
            ].join(" ")}
            title={opt.description}
            aria-pressed={isActive}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Map a Lens to the set of asset_classes it should match in Supabase queries.
 * `multi_asset` returns null (no filter).
 * `credit` matches both credit and rates (a credit book includes duration exposure).
 */
export function lensToAssetClasses(lens: Lens): string[] | null {
  switch (lens) {
    case "multi_asset":
      return null;
    case "credit":
      return ["credit", "rates"];
    case "rates":
      return ["rates"];
    case "equity":
      return ["equity"];
    case "fx":
      return ["fx"];
    case "commodity":
      return ["commodity"];
  }
}
