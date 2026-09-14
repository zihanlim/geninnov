import { MARK_SIZE_PX } from "@/lib/brand";

/**
 * The masthead's brand mark, rendered from `public/logo.png` (geninnov_black.png,
 * transparent background, 2048×2048 source). The PNG ships with a transparent
 * alpha and black ink; `filter: invert(1)` flips the ink to white while leaving
 * the alpha untouched, so the navy `--logo-plate` header shows through wherever
 * the source had no ink — no plate rectangle, no paper background.
 *
 * `aria-hidden` on purpose: the surrounding link already carries the brand name in
 * its `aria-label`, so naming the image too would read the brand twice to a screen
 * reader.
 */
export default function BrandMark({ size = MARK_SIZE_PX }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className="shrink-0"
      style={{ filter: "invert(1)" }}
    />
  );
}
