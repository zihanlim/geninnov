import { chromium } from "@playwright/test";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.resolve(process.cwd(), "../docs/captures/2026-07-27");

const browser = await chromium.launch();
const errors = [];

async function pass(label, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));

  await page.goto(`${BASE}/method/evidence`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(4000);

  const el = page.locator("#source-board");
  const mounted = (await el.count()) > 0;
  let text = null;
  if (mounted) {
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await el.screenshot({ path: path.join(OUT, `method-source-board-${label}.png`) });
    text = (await el.innerText()).replace(/\s+/g, " ");
  }
  const bodyScrollsX = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  await ctx.close();
  return { mounted, bodyScrollsX, text };
}

const desktop = await pass("desktop", 1440, 1000);
const mobile = await pass("mobile", 390, 844);
await browser.close();
console.log(JSON.stringify({ desktop, mobile, errors: errors.slice(0, 6) }, null, 2));
