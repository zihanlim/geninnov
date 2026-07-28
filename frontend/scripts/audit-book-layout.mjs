// Layout audit of a page, to see what it actually does with its width before
// reorganising it. Measures every top-level block under <main>, reports the width it
// occupies against the width available, and flags rows that end ragged. Throwaway
// harness — captures land in docs/captures/2026-07-27/.
//
//   ROUTE=/risk node scripts/audit-book-layout.mjs

import { chromium } from "@playwright/test";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
// Git Bash rewrites a leading "/" in an env var into a Windows path, so accept the
// route with or without one and normalise here.
const SLUG = (process.env.ROUTE ?? "book").replace(/^.*[\/\\]/, "") || "home";
const ROUTE = `/${SLUG === "home" ? "" : SLUG}`;
const OUT = path.resolve(process.cwd(), "../docs/captures/2026-07-27");

const browser = await chromium.launch();
const errors = [];

async function pass(label, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));

  await page.goto(`${BASE}${ROUTE}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(3000);

  const shell = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return null;
    const mainBox = main.getBoundingClientRect();

    // Walk the real content blocks: the direct children of the fragment that <main>
    // renders, one level deep, plus one more level inside each <section> so the
    // section-internal blocks are visible too.
    const rows = [];
    const walk = (el, depth, prefix) => {
      for (const child of Array.from(el.children)) {
        const b = child.getBoundingClientRect();
        if (b.height < 4) continue;
        const label =
          child.getAttribute("id") ||
          child.getAttribute("aria-label") ||
          child.querySelector("h1,h2,h3")?.textContent?.trim().slice(0, 44) ||
          child.className.toString().slice(0, 44) ||
          child.tagName;
        rows.push({
          depth,
          tag: child.tagName.toLowerCase(),
          label: prefix + label,
          top: Math.round(b.top + window.scrollY),
          h: Math.round(b.height),
          w: Math.round(b.width),
          cls: child.className.toString().slice(0, 110),
        });
        if (depth < 1 && (child.tagName === "SECTION" || child.tagName === "DIV")) {
          walk(child, depth + 1, "  ");
        }
      }
    };
    walk(main, 0, "");

    return {
      mainW: Math.round(mainBox.width),
      docH: Math.round(document.documentElement.scrollHeight),
      viewportH: window.innerHeight,
      bodyScrollsX:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      rows,
    };
  });

  await page.screenshot({
    path: path.join(OUT, `${SLUG}-layout-audit-${label}.png`),
    fullPage: true,
  });

  await ctx.close();
  return shell;
}

const w1440 = await pass("1440", 1440, 1000);
const w1024 = await pass("1024", 1024, 900);

await browser.close();

for (const [name, r] of [["1440", w1440], ["1024", w1024]]) {
  if (!r) { console.log(`${name}: no <main>`); continue; }
  console.log(`\n=== ${name}  main=${r.mainW}px  doc=${r.docH}px (${(r.docH / r.viewportH).toFixed(1)} screens)  bodyScrollsX=${r.bodyScrollsX}`);
  for (const row of r.rows) {
    const fill = ((row.w / r.mainW) * 100).toFixed(0).padStart(3);
    console.log(
      `${" ".repeat(row.depth * 2)}${String(row.h).padStart(5)}px  ${fill}%w  ${row.label}`
    );
  }
}
console.log("\nerrors:", JSON.stringify(errors, null, 1));
