// The mark exists three times and can only be drawn once.
//
// `lib/brand.ts` holds the path; `app/icon.svg` and `app/apple-icon.png` are
// generated from it and cannot import it — a favicon is fetched outside the
// document and a touch icon is a raster. So the three can drift, and the drift
// is invisible: nobody looks at a favicon on purpose. This asserts they agree,
// the same way chip-contrast.test.ts asserts globals.css and tailwind.config.ts
// agree about a colour neither file can read from the other.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import tailwindConfig from "@/tailwind.config";
import { MARK_PATH, MARK_PLATE_RADIUS, MARK_SIZE_PX } from "@/lib/brand";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

const ICON = read("app/icon.svg");
const GLOBALS = read("app/globals.css");
const PLATE = "#161b38";

describe("the brand mark", () => {
  it("draws the same path in app/icon.svg as in lib/brand.ts", () => {
    const d = ICON.match(/\sd="([^"]+)"/)?.[1];
    expect(d, "app/icon.svg has no path — regenerate it from MARK_PATH").toBeTruthy();
    expect(d).toBe(MARK_PATH);
  });

  it("keeps the plate on --logo-plate everywhere it is spelled out", () => {
    // The favicon carries the literal (no CSS variable is reachable from it).
    expect(ICON.toLowerCase()).toContain(`fill="${PLATE}"`);
    // globals.css and tailwind.config.ts are the two the app itself reads.
    expect(GLOBALS).toMatch(new RegExp(`--logo-plate:\\s*${PLATE}\\s*;`, "i"));
    const palette = (tailwindConfig.theme?.extend?.colors ?? {}) as Record<string, string>;
    expect(palette["logo-plate"]?.toLowerCase()).toBe(PLATE);
  });

  it("fills evenodd, or the gaps under the arms close up", () => {
    expect(ICON).toMatch(/fill-rule="evenodd"/);
    expect(read("components/BrandMark.tsx")).toMatch(/fillRule="evenodd"/);
  });

  it("keeps the figure inside the plate's corner radius", () => {
    // Every coordinate is in the 32-unit box, and the artwork's bbox clears the
    // rounded corners: a point at (2.5, 2.5) would be cut by an r=7 corner.
    const nums = MARK_PATH.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    expect(box.x0).toBeGreaterThanOrEqual(2);
    expect(box.y0).toBeGreaterThanOrEqual(2);
    expect(box.x1).toBeLessThanOrEqual(30);
    expect(box.y1).toBeLessThanOrEqual(30);
    // Corner clearance: the artwork is portrait and centred, so its corners are
    // the ones at risk. Distance from the plate's corner centre must exceed r.
    const r = MARK_PLATE_RADIUS;
    for (const [cx, cy, px, py] of [
      [r, r, box.x0, box.y0],
      [32 - r, r, box.x1, box.y0],
      [r, 32 - r, box.x0, box.y1],
      [32 - r, 32 - r, box.x1, box.y1],
    ]) {
      // Only the quadrant outside the corner centre can be clipped.
      const dx = Math.max(0, cx > 16 ? px - cx : cx - px);
      const dy = Math.max(0, cy > 16 ? py - cy : cy - py);
      expect(Math.hypot(dx, dy), `artwork enters the r=${r} corner`).toBeLessThanOrEqual(r);
    }
  });

  it("ships an apple-icon raster, because Safari ignores an SVG touch icon", () => {
    expect(statSync(path.join(root, "app/apple-icon.png")).size).toBeGreaterThan(1000);
  });

  it("renders the mark bigger than the letter tile it replaced", () => {
    // 22px was the gradient `A`. A thin-limbed silhouette needs more; if this is
    // ever pulled back down, the legs and the horizon arc merge into a blob.
    expect(MARK_SIZE_PX).toBeGreaterThanOrEqual(24);
  });

  it("has retired --brand, whose last call site was the tile the mark replaced", () => {
    expect(GLOBALS).not.toMatch(/--brand(-dim)?:/);
    const palette = (tailwindConfig.theme?.extend?.colors ?? {}) as Record<string, string>;
    expect(palette["brand"]).toBeUndefined();
    expect(palette["brand-dim"]).toBeUndefined();
  });
});
