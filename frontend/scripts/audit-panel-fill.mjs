// For each top-level panel on a page, how much of its WIDTH does its content actually
// use? A panel whose text stops at 45% of a 1344px row is a panel that wants a
// neighbour. Measures the rightmost edge of every leaf text/graphic node inside each
// panel, against the panel's own width. Throwaway harness.
//
//   BASE=http://localhost:3005 ROUTE=risk node scripts/audit-panel-fill.mjs

import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SLUG = (process.env.ROUTE ?? "book").replace(/^.*[\/\\]/, "");
const ROUTE = `/${SLUG}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.goto(`${BASE}${ROUTE}`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(3500);

const rows = await page.evaluate(() => {
  const main = document.querySelector("main");
  const out = [];

  // Every section's direct children are the panels.
  for (const sec of Array.from(main.children)) {
    if (sec.tagName !== "SECTION") continue;
    for (const panel of Array.from(sec.children)) {
      const pb = panel.getBoundingClientRect();
      if (pb.height < 20) continue;

      // Rightmost content edge: leaf elements only, ignoring full-bleed decoration
      // (borders, backgrounds, rules) by requiring the node to carry text or be a
      // graphic. A 1px <hr> spanning the panel is not content using the width.
      let maxRight = pb.left;
      const walk = (el) => {
        for (const c of Array.from(el.children)) {
          const cb = c.getBoundingClientRect();
          if (cb.width < 1 || cb.height < 1) continue;
          const leaf = c.children.length === 0;
          const graphic = ["SVG", "IMG", "CANVAS"].includes(c.tagName);
          const hasText = leaf && (c.textContent || "").trim().length > 0;
          if (hasText || graphic) {
            // Use the text's own inline box, not the block's, so a full-width <p>
            // holding a short sentence is measured by the sentence.
            const r = document.createRange();
            r.selectNodeContents(c);
            const tb = r.getBoundingClientRect();
            const right = tb.width > 0 ? tb.right : cb.right;
            if (right > maxRight) maxRight = right;
          }
          if (!graphic) walk(c);
        }
      };
      walk(panel);

      out.push({
        label:
          panel.querySelector(".card-title, h2, h3")?.textContent?.trim().slice(0, 40) ||
          panel.getAttribute("aria-label")?.slice(0, 40) ||
          panel.className.toString().slice(0, 40),
        section: sec.id || sec.getAttribute("aria-label") || "?",
        h: Math.round(pb.height),
        w: Math.round(pb.width),
        fill: Math.round(((maxRight - pb.left) / pb.width) * 100),
      });
    }
  }
  return out;
});

await browser.close();

console.log(`${ROUTE} — content fill per panel (1440 viewport)\n`);
let sec = null;
for (const r of rows) {
  if (r.section !== sec) { sec = r.section; console.log(`[${sec}]`); }
  const bar = "#".repeat(Math.round(r.fill / 5)).padEnd(20, ".");
  console.log(`  ${bar} ${String(r.fill).padStart(3)}%  ${String(r.h).padStart(5)}px  ${r.label}`);
}
const narrow = rows.filter((r) => r.fill < 70);
console.log(`\n${narrow.length} of ${rows.length} panels use <70% of their width:`);
for (const r of narrow) console.log(`   ${r.fill}%  ${r.h}px  ${r.label}`);
