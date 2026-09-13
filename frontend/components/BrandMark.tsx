import { MARK_SIZE_PX } from "@/lib/brand";

/**
 * The masthead's brand mark, rendered from `public/logo.svg`. The SVG is hard-stroked
 * (no brush effect) with a transparent background and `stroke="white"`, so it sits
 * directly on the navy `--logo-plate` header without any colour inversion or plate.
 * `MARK_SIZE_PX` from `lib/brand.ts` is still the default size.
 *
 * `aria-hidden` on purpose: the surrounding link already carries the brand name in
 * its `aria-label`, so naming the image too would read the brand twice to a screen
 * reader.
 */
export default function BrandMark({ size = MARK_SIZE_PX }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className="shrink-0"
    />
  );
}
