// Regenerate the geninnov mark from its source artwork.
//
//   node scripts/trace-brand-mark.mjs ../docs/brand/andromeda-mark-source.png
//
// Writes app/icon.svg and app/apple-icon.png, and prints the path data to paste
// into MARK_PATH in lib/brand.ts. All three must move together — a favicon has
// no module graph and Safari ignores an SVG touch icon, so neither icon can
// import the constant. tests/unit/brand-mark.test.ts fails if they disagree,
// which is the only thing standing between this and a favicon nobody re-checks.
//
// The pipeline: minimal PNG decoder -> binary mask at the midpoint between the
// plate and white -> pixel-edge boundary loops -> Ramer–Douglas–Peucker -> one
// <path>. The artwork is a two-colour silhouette, so a threshold IS the whole
// segmentation problem; there is nothing here worth a dependency. playwright-core
// is used only to rasterise the touch icon, and is already a devDependency.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../app");

/** Geometry, in the 32-unit box. Keep in step with lib/brand.ts. */
const FIGURE_HEIGHT = 27;
const PLATE_RADIUS = 7;
/** RDP tolerance in SOURCE pixels. The artwork is faceted, so this removes the
 *  raster staircase without touching a real vertex. */
const EPS = 1.2;
/** Loops smaller than this are antialiasing noise, not artwork. */
const MIN_AREA = 12;

// ── PNG decode ──────────────────────────────────────────────────────────────
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8;
  let ihdr = null;
  const idat = [];
  let plte = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "PLTE") plte = data;
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (ihdr.depth !== 8) throw new Error(`bit depth ${ihdr.depth} unsupported`);
  if (ihdr.interlace !== 0) throw new Error("interlaced unsupported");
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.color];
  if (!ch) throw new Error(`colour type ${ihdr.color} unsupported`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width: w, height: h } = ihdr;
  const stride = w * ch;
  const out = Buffer.alloc(stride * h);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[y * stride + i - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= ch && y > 0 ? out[(y - 1) * stride + i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      out[y * stride + i] = v & 0xff;
    }
  }
  const px = [];
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (ihdr.color === 0) r = g = b = out[i];
    else if (ihdr.color === 4) { r = g = b = out[i * 2]; a = out[i * 2 + 1]; }
    else if (ihdr.color === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
    else if (ihdr.color === 6) { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3]; }
    else { const p = out[i] * 3; r = plte[p]; g = plte[p + 1]; b = plte[p + 2]; }
    px.push([r, g, b, a]);
  }
  return { w, h, px };
}

// ── boundary loops ──────────────────────────────────────────────────────────
// Every unit edge where a foreground pixel meets background, oriented clockwise
// around the pixel, then chained into closed loops. Outer contours come out
// clockwise and holes counter-clockwise, which is what fill-rule:evenodd wants.
function traceLoops(mask, w, h) {
  const fg = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const key = (x, y) => y * (w + 1) + x;
  const edges = new Map();
  const push = (sx, sy, ex, ey) => {
    const k = key(sx, sy);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push([sx, sy, ex, ey]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!fg(x, y)) continue;
      if (!fg(x, y - 1)) push(x, y, x + 1, y);
      if (!fg(x + 1, y)) push(x + 1, y, x + 1, y + 1);
      if (!fg(x, y + 1)) push(x + 1, y + 1, x, y + 1);
      if (!fg(x - 1, y)) push(x, y + 1, x, y);
    }
  }
  const loops = [];
  const take = (k, prevDir) => {
    const list = edges.get(k);
    if (!list || list.length === 0) return null;
    if (list.length === 1) return list.shift();
    // Two edges leave this vertex: a diagonal touch. Take the sharpest right
    // turn so the walk hugs the foreground instead of cross-linking two loops.
    const rank = (e) => {
      const d = [Math.sign(e[2] - e[0]), Math.sign(e[3] - e[1])];
      const cross = prevDir[0] * d[1] - prevDir[1] * d[0];
      const dot = prevDir[0] * d[0] + prevDir[1] * d[1];
      return cross > 0 ? 0 : dot > 0 ? 1 : cross < 0 ? 2 : 3;
    };
    list.sort((a, b) => rank(a) - rank(b));
    return list.shift();
  };
  for (const [, list0] of edges) {
    while (list0.length) {
      const e = list0.shift();
      const pts = [[e[0], e[1]]];
      let dir = [Math.sign(e[2] - e[0]), Math.sign(e[3] - e[1])];
      let cur = [e[2], e[3]];
      let guard = 0;
      while (!(cur[0] === pts[0][0] && cur[1] === pts[0][1]) && guard++ < 4 * w * h) {
        pts.push([cur[0], cur[1]]);
        const nxt = take(key(cur[0], cur[1]), dir);
        if (!nxt) break;
        dir = [Math.sign(nxt[2] - nxt[0]), Math.sign(nxt[3] - nxt[1])];
        cur = [nxt[2], nxt[3]];
      }
      if (pts.length > 3) loops.push(pts);
    }
  }
  return loops;
}

// ── simplify ────────────────────────────────────────────────────────────────
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  let idx = -1, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px2, py] = pts[i];
    const d = len === 0 ? Math.hypot(px2 - ax, py - ay)
      : Math.abs(dy * px2 - dx * py + bx * ay - by * ax) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

function simplifyLoop(pts, eps) {
  // Rotate to an extreme point first, so the closing seam is never the segment
  // RDP decides to straighten across.
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][1] < pts[s][1] || (pts[i][1] === pts[s][1] && pts[i][0] < pts[s][0])) s = i;
  }
  const rot = [...pts.slice(s), ...pts.slice(0, s)];
  const out = rdp([...rot, rot[0]], eps);
  out.pop();
  return out;
}

const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};

// ── main ────────────────────────────────────────────────────────────────────
const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/trace-brand-mark.mjs <source.png>");
  process.exit(1);
}
const { w, h, px } = decodePng(readFileSync(path.resolve(process.cwd(), src)));

// The plate is whatever colour dominates the frame; the figure is what is
// brighter than halfway between it and white. Both are read off the artwork
// rather than assumed, so a re-export on a different ground still traces.
const tally = new Map();
for (let x = 0; x < w; x++) {
  for (const y of [0, h - 1]) {
    const k = px[y * w + x].slice(0, 3).join(",");
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
}
const plateRgb = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
const PLATE = "#" + plateRgb.map((n) => n.toString(16).padStart(2, "0")).join("");
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const thresh = (lum(plateRgb) + 255) / 2;

const mask = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) mask[i] = px[i][3] > 127 && lum(px[i]) > thresh ? 1 : 0;

const loops = traceLoops(mask, w, h)
  .map((p) => simplifyLoop(p, EPS))
  .filter((p) => p.length >= 3 && Math.abs(area(p)) >= MIN_AREA);
if (loops.length === 0) throw new Error("traced nothing — check the threshold");

let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const l of loops) for (const [x, y] of l) {
  if (x < minX) minX = x; if (x > maxX) maxX = x;
  if (y < minY) minY = y; if (y > maxY) maxY = y;
}
const bw = maxX - minX, bh = maxY - minY;
const s = FIGURE_HEIGHT / bh;
const ox = (32 - bw * s) / 2, oy = (32 - FIGURE_HEIGHT) / 2;
const fmt = (n) => String(Math.round(n * 100) / 100);
const d = loops
  .map((l) => "M" + l.map(([x, y]) => `${fmt((x - minX) * s + ox)} ${fmt((y - minY) * s + oy)}`).join("L") + "Z")
  .join("");

writeFileSync(
  path.join(APP, "icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">\n` +
    `  <rect width="32" height="32" rx="${PLATE_RADIUS}" fill="${PLATE}"/>\n` +
    `  <path fill="#fff" fill-rule="evenodd" d="${d}"/>\n</svg>\n`,
);

// Full-bleed for the touch icon: iOS applies its own mask, so a corner radius
// here would be rounded twice.
const pw = await import("playwright-core");
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 180, height: 180 } });
await page.setContent(
  `<body style="margin:0"><svg width="180" height="180" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="32" height="32" fill="${PLATE}"/>` +
    `<path fill="#fff" fill-rule="evenodd" d="${d}"/></svg></body>`,
);
await page.locator("svg").screenshot({ path: path.join(APP, "apple-icon.png") });
await browser.close();

console.log(`source ${w}×${h}, plate ${PLATE}, ${loops.length} loops, ${d.length} bytes`);
console.log(`figure ${fmt(bw * s)}×${FIGURE_HEIGHT} at (${fmt(ox)}, ${fmt(oy)}) in a 32 box`);
console.log("\nwrote app/icon.svg + app/apple-icon.png");
console.log("paste into lib/brand.ts as MARK_PATH:\n");
console.log(JSON.stringify(d));
