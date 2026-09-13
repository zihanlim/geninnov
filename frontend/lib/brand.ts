/**
 * The geninnov mark — the figure on the horizon, traced from the supplied
 * artwork (`docs/brand/andromeda-mark-source.png`, 892×896, white silhouette on
 * #161b38) by `scripts/trace-brand-mark.mjs`, which is deterministic: re-running
 * it on the same source reproduces this string byte for byte.
 *
 * ONE path, ONE geometry, THREE renderers:
 *   - components/BrandMark.tsx   the masthead lockup
 *   - app/icon.svg               the favicon (a standalone file — a favicon is
 *                                fetched outside the page, so it cannot read a
 *                                CSS variable and carries the plate as a literal)
 *   - app/apple-icon.png         the iOS touch icon (Safari ignores SVG here)
 *
 * `icon.svg` and `apple-icon.png` are BUILD OUTPUTS of this path — they cannot
 * import it, so `tests/unit/brand-mark.test.ts` asserts byte-equality of the
 * path data and of the plate colour against `--logo-plate`. Regenerate all
 * three together or that test fails, which is the point: the last mark drifted
 * into being a placeholder letter nobody re-checked.
 *
 * Coordinates are in a 32×32 box: the artwork's 474×602 bounding box scaled to
 * 27 tall (21.26 wide) and centred, leaving 2.5 units of margin top and bottom
 * for the plate's 7-unit corner radius. Rendered from a 474×602 source, so the
 * 2dp coordinates are ~0.06 source-pixel precision — the visible facets are the
 * artwork's own, not the tracer's.
 *
 * fill-rule MUST be evenodd: the two gaps under the arms and the gap between
 * the legs are separate loops, and under the default nonzero they fill in.
 */
export const MARK_PATH =
  "M15.78 2.5L16.09 2.54L17.26 3.04L17.48 4.47L17.61 4.38L17.75 4.43L17.75 4.97L17.61 5.42L17.35 5.46L17.26 6.13L16.54 6.67L16.49 7.34L17.21 7.75L17.93 7.7L21.11 10.12L21.7 10.48L21.83 10.62L21.88 10.89L21.88 11.02L21.07 11.83L20.98 11.83L20.13 12.73L20.04 12.73L19.18 13.62L18.96 13.76L18.51 14.56L18.33 14.56L18.69 15.46L20.62 17.3L20.62 18.33L19.59 18.96L19.5 18.96L19.59 18.6L19.54 18.2L19.05 18.02L18.11 18.15L18.24 19.77L18.2 20.8L18.56 25.15L19.36 25.64L19.59 25.91L21.43 26.41L23.49 27.3L25.33 28.42L26.63 29.5L24.66 28.78L22.1 28.11L19.77 27.71L17.17 27.48L14.65 27.48L11.43 27.8L8.24 28.47L5.37 29.41L6.49 28.47L8.06 27.48L10.21 26.5L12.23 25.91L12.32 25.69L13.17 25.15L13.22 24.97L13.58 20.75L13.58 19.59L12.86 19.77L10.3 19.9L8.33 18.83L8.2 18.33L8.73 18.51L8.91 18.47L8.06 17.7L8.02 17.08L9.09 17.61L10.53 17.61L10.57 17.52L11.02 17.35L11.07 17.26L12.32 16.58L13.58 14.56L13.44 14.56L12.91 13.85L12.68 13.71L10.03 11.11L10.03 10.62L13.62 7.7L14.43 7.75L15.15 7.43L15.15 6.81L15.01 6.58L14.83 6.54L14.56 6.31L12.32 6.81L9.81 6.22L8.38 6.99L8.82 6.22L9.14 6.09L9.9 5.5L8.06 6.4L7.97 6.36L8.64 5.42L10.44 4.56L10.39 4.52L9.81 4.79L9 5.01L9.63 4.2L10.93 3.76L12.32 3.89L15.01 2.63ZM13.26 9.54L11.16 10.93L13.08 13.04L13.13 13.17L13.53 13.17L13.8 13.13L13.67 10.3L13.62 9.95ZM18.33 9.54L17.97 10.03L17.93 13.13L18.56 13.17L20.04 11.6L20.04 11.51L20.57 11.02L20.57 10.93ZM16.54 18.47L15.15 18.96L14.97 19.14L14.74 20.17L14.74 20.8L14.16 23.18L13.89 24.79L13.89 25.1L14.07 25.37L14.07 25.55L14.16 25.6L15.33 25.46L16.54 25.46L17.66 25.6L17.7 25.33L17.88 25.06L17.57 23.13L16.99 20.84L16.94 19.86L16.76 18.78L16.67 18.47Z";

/** The plate's corner radius in the 32-unit box. */
export const MARK_PLATE_RADIUS = 7;

/**
 * 26px, not the 22px the old letter-tile used. Measured at 22px the legs, the
 * ponytail and the horizon arc all collapse into one blob — this artwork is a
 * thin-limbed silhouette, not a letterform, and it needs the extra 4px to stay
 * readable as a figure. 26 of the 56px bar leaves the lockup balanced against
 * the 15px wordmark beside it.
 */
export const MARK_SIZE_PX = 26;
