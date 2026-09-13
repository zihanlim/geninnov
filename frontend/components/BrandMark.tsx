import { MARK_SIZE_PX } from "@/lib/brand";

/**
 * The masthead's brand mark, currently rendered from
 * `public/logo_infinity_ribbon_bold.png` (the geninnov mark source). The previous
 * inline-SVG path traced from `docs/brand/geninnov-mark-source.png` is still in
 * `lib/brand.ts` for `--logo-plate` colour callers; the visual masthead mark is
 * now this raster. Regenerate the PNG and re-deploy to change it.
 *
 * `aria-hidden` on purpose: the surrounding link already carries the brand name
 * in its `aria-label`, so naming the image too would read the brand twice to a
 * screen reader.
 */
export default function BrandMark({ size = MARK_SIZE_PX }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo_infinity_ribbon_bold.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className="shrink-0"
      style={{ filter: "invert(1)" }}
    />
  );
}
