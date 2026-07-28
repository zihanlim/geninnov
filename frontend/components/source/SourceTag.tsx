// frontend/components/source/SourceTag.tsx
//
// Inline source/character pill, prototype-provenance: 2px x 6px, fully rounded,
// 9px uppercase Inter, 0.5px border. Mirror of the .provenance-badge class in
// the 2026-07-29 prototype at
//   stitch_remix_of_auralis_saas_landing_page/.../andromeda_the_100m_book_refined/code.html
// The vocabulary lives in lib/sourceTokens.ts for the same reason the other
// chip maps live in lib/: tests can import the classes and assert contrast
// without mounting the component (see tests/unit/chip-contrast.test.ts).
//
// A `marginLeft=true` (default) is built in because every shipped use of this
// pill sits immediately to the right of a figure, and adding the gap via the
// callers class string is repetition the component can absorb. When the pill
// is the FIRST element of a row the caller passes marginLeft={false}.

import type { ReactNode } from "react";
import { SOURCE_CHIPS, type SourceToken } from "@/lib/sourceTokens";

export type { SourceToken };
export { SOURCE_CHIPS };

export type SourceTagProps = {
  token: SourceToken;
  /** Override the default hover title for the token. */
  detail?: string;
  /** Override the label entirely. Defaults to the token string. */
  label?: ReactNode;
  /** Stack next to a number on the right by default. Set false when leading. */
  marginLeft?: boolean;
  className?: string;
};

export function SourceTag({
  token,
  detail,
  label,
  marginLeft = true,
  className = "",
}: SourceTagProps) {
  const entry = SOURCE_CHIPS[token];
  return (
    <span
      // `inline-block` so a flex column line-up survives a stretchy parent;
      // `rounded-full` matches the prototype (border-radius: 9999px); the 0.5px
      // border matches the materials hairline weight.
      className={`inline-block self-start rounded-full border-[0.5px] py-0.5 px-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] leading-none whitespace-nowrap ${
        marginLeft ? "ml-2 " : ""
      }${entry.cls}${className ? ` ${className}` : ""}`}
      title={detail ?? entry.detail}
      aria-label={detail ?? entry.detail}
    >
      {label ?? token}
    </span>
  );
}

export default SourceTag;