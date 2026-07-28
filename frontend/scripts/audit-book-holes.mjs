// Measures the empty area inside /book's multi-column rows: for each grid, the cells'
// heights against the row height, and the void a short cell leaves under it. Throwaway.

import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await chromium.launch();

async function pass(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${process.env.ROUTE ?? "/book"}`, {
    waitUntil: "networkidle",
    timeout: 90000,
  });
  await page.waitForTimeout(3000);

  return page.evaluate(() => {
    const out = [];
    for (const g of Array.from(document.querySelectorAll("main div"))) {
      const cs = getComputedStyle(g);
      if (cs.display !== "grid") continue;
      const cols = cs.gridTemplateColumns.split(" ").filter(Boolean).length;
      const kids = Array.from(g.children)
        .map((c) => {
          const b = c.getBoundingClientRect();
          return {
            label:
              c.querySelector("h2,h3")?.textContent?.trim().slice(0, 34) ||
              c.className.toString().slice(0, 34),
            h: Math.round(b.height),
            w: Math.round(b.width),
            x: Math.round(b.left),
            y: Math.round(b.top + window.scrollY),
          };
        })
        .filter((k) => k.h > 4);
      if (kids.length < 2) continue;
      const gb = g.getBoundingClientRect();

      // Group cells into visual rows by their y.
      const rows = [];
      for (const k of kids) {
        const r = rows.find((r) => Math.abs(r.y - k.y) < 12);
        if (r) r.cells.push(k);
        else rows.push({ y: k.y, cells: [k] });
      }
      const rowStats = rows.map((r) => {
        const tallest = Math.max(...r.cells.map((c) => c.h));
        const emptyCols = cols - r.cells.length;
        const cellW = r.cells[0].w;
        const voidPx =
          r.cells.reduce((s, c) => s + (tallest - c.h) * c.w, 0) +
          emptyCols * cellW * tallest;
        return {
          cells: r.cells.map((c) => `${c.label}:${c.h}`),
          tallest,
          emptyCols,
          voidPx,
        };
      });
      out.push({
        grid: g.className.toString().slice(0, 70),
        cols,
        gridH: Math.round(gb.height),
        gridW: Math.round(gb.width),
        rows: rowStats,
        voidShare:
          (rowStats.reduce((s, r) => s + r.voidPx, 0) /
            (gb.width * gb.height)) *
          100,
      });
    }
    return out;
  }).finally(() => ctx.close());
}

for (const w of [1440, 1600, 1024]) {
  console.log(`\n===== ${w}px =====`);
  for (const g of await pass(w, 1000)) {
    console.log(
      `\ngrid[${g.cols} cols] ${g.gridW}x${g.gridH}  void=${g.voidShare.toFixed(0)}%  ${g.grid}`
    );
    for (const r of g.rows)
      console.log(
        `   row tallest=${r.tallest} emptyCols=${r.emptyCols} void=${Math.round(r.voidPx / 1000)}k px²  [${r.cells.join(", ")}]`
      );
  }
}
await browser.close();
