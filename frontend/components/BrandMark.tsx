import { MARK_PATH, MARK_PLATE_RADIUS, MARK_SIZE_PX } from "@/lib/brand";

/**
 * The Andromeda mark on its plate — the masthead's half of the lockup.
 *
 * The plate is `var(--logo-plate)` rather than a Tailwind class so the one
 * navy in this project stays a token the palette test can see, and so this
 * component holds no colour of its own. White is hardcoded because the mark IS
 * white-on-navy: it is not tinted by context and must not be, so `currentColor`
 * here would be an affordance for something that may never happen.
 *
 * `aria-hidden` on purpose. The mark sits inside a link that already carries
 * the word ANDROMEDA at ≥sm and an `aria-label` below that, so naming the SVG
 * too would read the brand twice to a screen reader.
 */
export default function BrandMark({ size = MARK_SIZE_PX }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <rect width="32" height="32" rx={MARK_PLATE_RADIUS} fill="var(--logo-plate)" />
      {/* evenodd, not the default nonzero — the gaps under the arms and between
          the legs are separate loops and fill in without it. */}
      <path d={MARK_PATH} fill="#ffffff" fillRule="evenodd" />
    </svg>
  );
}
