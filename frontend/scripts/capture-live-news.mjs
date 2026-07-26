import { chromium } from "@playwright/test";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.resolve(process.cwd(), "../docs/captures/2026-07-27");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const yt = [];
page.on("request", (r) => {
  if (/youtube|ytimg|googlevideo|google\.com/.test(r.url())) yt.push(r.url().slice(0, 80));
});

await page.goto(BASE, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(3000);

const panel = page.locator('section[aria-labelledby="live-news-heading"]');
const mounted = (await panel.count()) > 0;
if (!mounted) { console.log(JSON.stringify({ mounted })); await browser.close(); process.exit(0); }

await panel.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await panel.screenshot({ path: path.join(OUT, "home-live-news-closed.png") });
const requestsBeforeOpen = yt.length;

// Open it, then confirm an iframe appears and points where we expect.
await panel.getByRole("button", { name: /open stream/i }).click();
await page.waitForTimeout(3500);
await panel.screenshot({ path: path.join(OUT, "home-live-news-open.png") });

const frameSrc = await panel.locator("iframe").first().getAttribute("src");
const tabs = await panel.getByRole("tab").allInnerTexts();

// Switch channel and confirm the src follows.
await panel.getByRole("tab", { name: "Al Jazeera" }).click();
await page.waitForTimeout(2500);
const afterSwitch = await panel.locator("iframe").first().getAttribute("src");
await panel.screenshot({ path: path.join(OUT, "home-live-news-aljazeera.png") });

const bodyScrollsX = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
);

await browser.close();
console.log(JSON.stringify({
  mounted, tabs, requestsBeforeOpen, requestsAfterOpen: yt.length,
  frameSrc, afterSwitch, bodyScrollsX,
}, null, 2));
