// Which panels can survive being halved? Renders the page at a narrow viewport and
// reports, per panel, whether anything inside it overflows horizontally — a table with
// a min-width, a fixed-width svg, a row grid that cannot reflow. A panel that is clean
// at ~660px can share a row at 1440; one that scrolls cannot. Throwaway harness.
//
//   BASE=http://localhost:3005 ROUTE=risk node scripts/audit-panel-minwidth.mjs

import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SLUG = (process.env.ROUTE ?? "book").replace(/^.*[\/\\]/, "");

// main is max-w-[1400px] with px-8 at lg, so a 2-col row at 1440 gives each panel
// (1344 - 24 gap) / 2 = 660px. Emulate that with a viewport whose main is ~660.
const NARROW = 660 + 64;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: NARROW, height: 1000 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/${SLUG}`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(3500);

const rows = await page.evaluate(() => {
  const main = document.querySelector("main");
  const out = [];
  for (const sec of Array.from(main.children)) {
    if (sec.tagName !== "SECTION") continue;
    for (const panel of Array.from(sec.children)) {
      const pb = panel.getBoundingClientRect();
      if (pb.height < 30) continue;

      // Anything inside that is wider than the panel, or scrolls inside it.
      let widest = 0;
      let culprit = "";
      const walk = (el) => {
        for (const c of Array.from(el.children)) {
          const cs = getComputedStyle(c);
          const overflows = c.scrollWidth > c.clientWidth + 2 && c.clientWidth > 0;
          const need = overflows ? c.scrollWidth : c.getBoundingClientRect().width;
          if (need > widest + 1) {
            widest = need;
            culprit = `${c.tagName.toLowerCase()}.${c.className.toString().slice(0, 44)}`;
          }
          if (cs.overflowX !== "visible" && overflows) continue; // don't recurse past a scroller
          walk(c);
        }
      };
      walk(panel);

      out.push({
        sec: sec.id || "?",
        label:
          panel.querySelector(".card-title, h2, h3")?.textContent?.trim().slice(0, 36) ||
          panel.className.toString().slice(0, 36),
        panelW: Math.round(pb.width),
        needs: Math.round(widest),
        h: Math.round(pb.height),
        culprit: widest > pb.width + 2 ? culprit : "",
      });
    }
  }
  return out;
});

await browser.close();

console.log(`/${SLUG} at main≈${NARROW - 64}px — can each panel be half-width?\n`);
let s = null;
for (const r of rows) {
  if (r.sec !== s) { s = r.sec; console.log(`[${s}]`); }
  const ok = r.needs <= r.panelW + 2;
  console.log(
    `  ${ok ? "FITS   " : "SCROLLS"} needs ${String(r.needs).padStart(4)} / ${r.panelW}  ${String(r.h).padStart(4)}px  ${r.label}${r.culprit ? `   <- ${r.culprit}` : ""}`
  );
}
