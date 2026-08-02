import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

// Capture the /datamap diagram and report:
//   1. Does the page need horizontal scroll at desktop viewport?
//   2. Any console errors?
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.resolve(process.cwd(), "../docs/captures/2026-08-02");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const errors = [];

async function pass(label, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));

  await page.goto(`${BASE}/datamap`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(3500);

  // Check for horizontal scroll at the page level.
  const scrollsX = await page.evaluate(() => {
    return {
      documentScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      bodyScrollsX: document.body.scrollWidth > document.body.clientWidth + 1,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
    };
  });

  await page.screenshot({
    path: path.join(OUT, `datamap-${label}.png`),
    fullPage: true,
  });
  await ctx.close();
  return scrollsX;
}

const wide = await pass("wide-2560", 2560, 1200);
const desktop = await pass("desktop-1440", 1440, 1000);
await browser.close();

console.log(JSON.stringify({ wide, desktop, errors: errors.slice(0, 8) }, null, 2));
