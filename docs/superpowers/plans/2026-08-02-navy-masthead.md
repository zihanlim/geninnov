# Navy Masthead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 56px `TopBar` on every page a solid navy (`--logo-plate` `#161b38`) masthead with a light-on-navy token ladder, verified against the AA floor.

**Architecture:** The header flips to the mark's own navy (the "brand ground", per ADR-0223). A seven-token `--header-*` ladder lives in `globals.css` `:root` AND `tailwind.config.ts` `colors` (kept in step by the existing palette-integrity test). `TopBar.tsx` and `RibbonControl.tsx` swap their paper-ink utilities for `header-*` utilities; geometry, sticky, z-index and the portalled light panels are untouched. `chip-contrast.test.ts` gains a header-ladder block so goal 8 is measured on the new surface.

**Tech Stack:** Next.js 14 (App Router), Tailwind CSS 3, TypeScript, vitest. Tests: `npx vitest run <file>`, typecheck `npm run typecheck`, build `npm run build`.

## Global Constraints

- **Two sessions share this worktree.** Commit every task with the two-session-safe pattern — stage AND commit in ONE call with explicit paths:
  `git add -- <new-paths> && git commit --only -F - -- <paths> <<'EOF' … EOF`
  `git commit -- <path>` errors on untracked files, so `git add` them in the same call. Never `git stash`. When touching a shared doc row, keep every side's entries.
- **ADR-0223 is the decision and is already committed** (`docs/adrs/0223-the-navy-is-the-brand-ground.md`). It amends ADR-0113's fence: `--logo-plate` is the *brand ground* — mark + masthead. Do not re-litigate. If a new decision surfaces, claim the next ADR number after checking `ls docs/adrs/` at write time.
- **No hex / rgb literals in `app/`, `components/`, `lib/`** — `chip-contrast.test.ts`'s no-hex scan fails otherwise. `TopBar.tsx` and `RibbonControl.tsx` must use only `header-*` utility classes (and the existing `num`, `card` primitives).
- **`globals.css` `:root` and `tailwind.config.ts` `colors` must stay in step.** Tailwind compiles to literal RGB and never reads the variables. Add each token to BOTH files in the same task.
- **No `--header-*` token is used outside the header.** Portalled panels (Ask popover, Live news window, Data map dock) stay light cards — only the in-bar buttons flip.
- **`next build` and `next dev` share `.next`** — build only when no dev server is running, and don't build while a dev server is up.
- **Windows saves can mojibake UTF-8.** Prefer `Edit` over whole-file `Write` on frontend files. If a file shows `â€"`/`âˆ'`, reverse only the cleanly-round-tripping runs.
- **Values are frozen by ADR-0223** (all measured): `--header-ink #ffffff` 16.83:1, `--header-muted #b6bbca` 8.77:1, `--header-tertiary #8d93a3` 5.48:1 on navy / 4.80:1 on raised, `--header-raised #1f2740` (1.70× navy's luminance), `--header-focus #9ad9e4` 10.75:1, `--header-warning #e07a4a` 5.65:1 on navy / 4.96:1 on raised, `--header-border rgba(255,255,255,0.12)`.

---

### Task 1: Header-ladder test block (red)

**Files:**
- Modify: `frontend/tests/unit/chip-contrast.test.ts` — insert a new `describe` after the `chip contrast` block (ends line ~248, after the `"uses palette tokens only"` test's closing `});`).

**Interfaces:**
- Produces: the header-ladder assertions. They read `PALETTE["header-*"]` — which does NOT exist yet, so this task must fail. Task 2 supplies the tokens.

- [ ] **Step 1: Write the failing test block**

Insert after the `chip contrast` describe block (after line 248's `});`):

```ts
// ── the header ladder on the navy masthead (ADR-0223) ──────────────────────────
//
// The 56px TopBar is a solid #161b38 band on every page, so its contents use a
// light-on-navy ladder (--header-*) instead of paper ink. Goal 8's floor must be
// measured here too — a ladder of ink-over-surface pairs the page never had. The
// three text inks are checked on BOTH grounds the header has: plain navy and the
// raised block (--header-raised) that the run-state group and active nav sit on.
// The two non-text tokens (focus ring, stale dot) clear the 3:1 WCAG 1.4.11 floor.

describe("header ladder on the navy masthead (ADR-0223)", () => {
  const NAVY = parseColor(PALETTE["logo-plate"])!;
  const RAISED = parseColor(PALETTE["header-raised"])!;
  const head = (token: string) => parseColor(PALETTE[token])!;

  it.each([
    ["header-ink", 4.5],
    ["header-muted", 4.5],
    ["header-tertiary", 4.5],
  ] as const)("%s clears AA on navy and on the raised surface", (token, floor) => {
    const fg = head(token);
    for (const [label, surface] of [
      ["navy", NAVY],
      ["raised", RAISED],
    ] as const) {
      const ratio = contrast(fg, surface);
      expect(
        ratio,
        `${token} is ${ratio.toFixed(2)}:1 on ${label}`,
      ).toBeGreaterThanOrEqual(floor);
    }
  });

  it.each([
    ["header-focus", 3],
    ["header-warning", 3],
  ] as const)("%s clears the 3:1 non-text floor on the raised surface", (token, floor) => {
    const ratio = contrast(head(token), RAISED);
    expect(ratio, `${token} is ${ratio.toFixed(2)}:1 on raised`).toBeGreaterThanOrEqual(floor);
  });

  it("keeps the three freshness dots distinct values", () => {
    // Goal 3: the words carry the meaning, the colour only separates the cases —
    // but a dot that equals another dot's value separates nothing.
    expect(head("header-ink")).not.toEqual(head("header-warning"));    // live vs stale
    expect(head("header-warning")).not.toEqual(head("header-tertiary")); // stale vs unknown
    expect(head("header-ink")).not.toEqual(head("header-tertiary"));   // live vs unknown
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/chip-contrast.test.ts`
Expected: FAIL — `PALETTE["header-raised"]` is `undefined`, and `parseColor(undefined)` throws `TypeError: Cannot read properties of undefined (reading 'trim')`. That is the correct red: the tokens the floor depends on do not exist yet.

- [ ] **Step 3: Commit the failing test**

```bash
git add -- frontend/tests/unit/chip-contrast.test.ts && git commit --only -F - -- frontend/tests/unit/chip-contrast.test.ts <<'EOF'
test: header-ladder AA block on the navy masthead (ADR-0223) — red

Goal 8's floor must be measured on the new #161b38 surface. Three text
inks clear 4.5:1 on navy AND the raised block; focus ring + stale dot
clear 3:1; the three freshness dots stay distinct.
EOF
```

---

### Task 2: The token ladder in `globals.css` + `tailwind.config.ts`

**Files:**
- Modify: `frontend/app/globals.css` — update the `--logo-plate` comment (lines ~124–141), add the header token block after `--logo-plate`, add the scoped `header :focus-visible` rule after the global one (lines ~424–432).
- Modify: `frontend/tailwind.config.ts` — update the `logo-plate` comment, add the seven `header-*` colours after `logo-plate` (line ~117).

**Interfaces:**
- Consumes: the failing assertions from Task 1 (`PALETTE["header-*"]`, `PALETTE["logo-plate"]`).
- Produces: the tokens `--header-ink / --header-muted / --header-tertiary / --header-raised / --header-border / --header-focus / --header-warning` (both files), the scoped header focus-ring rule, and the widened `--logo-plate` fence comment. Tasks 3–4 consume the tokens.

- [ ] **Step 1: Update the `--logo-plate` comment in `globals.css`**

Replace the comment block beginning `/* THE GROUND OF THE LOGO ARTWORK, AND NOTHING ELSE.` with:

```css
    /* THE GROUND OF THE BRAND — THE LOGO ARTWORK AND THE MASTHEAD (ADR-0223).
       Measured off the supplied mark (andromeda-analytics.png): 717,750 of its
       799,232 pixels are exactly #161b38, and the figure on it is exactly #fff.
       It is here as a token so the one navy in this project is a thing the
       palette test can see — not so it becomes available. ADR-0113 fenced it to
       the mark; ADR-0223 widened the fence to the brand ground: the mark AND the
       56px TopBar masthead, which is now a solid #161b38 band on every page.
       It is still NOT a chip, NOT an ink, NOT a panel, NOT a footer. A proposal
       that reaches for it for anything but the mark or the masthead is reaching
       for the dark dashboard by increments. Its call sites are
       components/BrandMark.tsx, the two generated icons (all three asserted by
       tests/unit/brand-mark.test.ts) and the header surface in TopBar.tsx.

       It REPLACES --brand/--brand-dim, which ADR-0085 §3 deleted and which then
       survived in one place: the masthead's gradient `A` tile, running
       accent → brand. That tile is now the real mark, so the last call site is
       gone and the token with it. Nothing else referenced either name — the
       usages that made --brand a live defect (AbstentionRoster's focus ring and
       ConvictionCard's emphasis gradient, both painting "emphasis" in exactly
       the colour of a short position) had already moved to --accent. */
```

And update the inline comment on the token itself:

```css
    --logo-plate: #161b38;   /* brand ground — the mark's plate AND the masthead (ADR-0223) */
```

- [ ] **Step 2: Add the header token block to `globals.css`**

Immediately after the `--logo-plate` line, insert:

```css

    /* Header ladder — light on the navy masthead (ADR-0223).
       The 56px TopBar is a solid #161b38 band on every page, so its contents
       flip from paper ink to light-on-navy. These tokens are the ONLY ones
       allowed in the header, and they are used nowhere else. Kept in step with
       tailwind.config.ts by the palette-integrity test.

       Measured (asserted by the header-ladder block in
       tests/unit/chip-contrast.test.ts):
         ink #ffffff      16.83:1 on #161b38
         muted #b6bbca     8.77:1 on #161b38
         tertiary #8d93a3  5.48:1 on #161b38, 4.80:1 on raised
       --header-raised #1f2740 is the SECOND surface of the bar — the nav active
       block and the run-state group. It exists because the dimmest ink (tertiary)
       fails AA 4.5 on a lighter raised; #1f2740 is the darkest step that still
       reads as raised (1.70x the navy's luminance).
       --header-focus #9ad9e4: the global ring is teal --accent, 2.6:1 on navy —
       the header scopes its own ring to clear WCAG 1.4.11 (3:1); 10.75:1 here.
       --header-warning #e07a4a: the page's --warning is 2.5:1 on navy, so the
       STALE freshness dot lightens; 5.65:1 on navy, 4.96:1 on raised. */
    --header-ink: #ffffff;
    --header-muted: #b6bbca;
    --header-tertiary: #8d93a3;
    --header-raised: #1f2740;
    --header-border: rgba(255, 255, 255, 0.12);
    --header-focus: #9ad9e4;
    --header-warning: #e07a4a;
```

- [ ] **Step 3: Add the scoped header focus ring to `globals.css`**

After the global `:focus-visible` block in `@layer utilities` (ends ~line 432), add:

```css
  /* The masthead is navy (ADR-0223); teal --accent measures 2.6:1 on #161b38 —
     under the 3:1 non-text floor. The header scopes its own ring to a light
     cyan. The descendant selector is more specific than the rule above, so it
     wins for anything inside the bar. */
  header :focus-visible {
    outline-color: var(--header-focus);
  }
```

- [ ] **Step 4: Update the `logo-plate` comment in `tailwind.config.ts`**

Replace the comment block above `"logo-plate": "#161b38",` (lines ~110–116) with:

```ts
        // BRAND GROUND — the supplied mark artwork's plate AND the 56px masthead
        // (ADR-0223, widening ADR-0113's fence from "the mark only"). Not a chip,
        // not an ink, not a panel; see globals.css for why it is fenced and for
        // what it replaced (--brand/--brand-dim, the last survivors of ADR-0085
        // §3, which lived in the masthead tile the real mark replaced). Its one
        // utility consumer is the header surface (`bg-logo-plate` in TopBar.tsx);
        // BrandMark reads var(--logo-plate) directly. Declared here so the
        // palette-drift test in chip-contrast.test.ts compares it against
        // globals.css.
        "logo-plate": "#161b38",
```

- [ ] **Step 5: Add the header colours to `tailwind.config.ts`**

Immediately after the `"logo-plate"` line, add:

```ts
        // Header ladder — light on the navy masthead (ADR-0223). The TopBar is
        // solid --logo-plate on every page, so its contents use these instead of
        // paper ink. Header-only; see globals.css for the measured contrast.
        "header-ink": "#ffffff",
        "header-muted": "#b6bbca",
        "header-tertiary": "#8d93a3",
        "header-raised": "#1f2740",
        "header-border": "rgba(255,255,255,0.12)",
        "header-focus": "#9ad9e4",
        "header-warning": "#e07a4a",
```

- [ ] **Step 6: Run the header-ladder test to verify it passes**

Run: `npx vitest run tests/unit/chip-contrast.test.ts`
Expected: PASS — all three `it.each` + the dot-distinctness test now resolve real tokens (ink 16.83, muted 8.77, tertiary 5.48/4.80, focus 10.75 on raised, warning 4.96 on raised), and the existing palette-integrity / no-hex / drift tests stay green.

- [ ] **Step 7: Commit**

```bash
git add -- frontend/app/globals.css frontend/tailwind.config.ts && git commit --only -F - -- frontend/app/globals.css frontend/tailwind.config.ts <<'EOF'
feat: header token ladder + scoped focus ring for the navy masthead

--header-ink/muted/tertiary/raised/border/focus/warning in both
globals.css :root and tailwind.config.ts colors (kept in step by the
palette-integrity test). --logo-plate fence comment widened to "brand
ground — mark + masthead" per ADR-0223. header :focus-visible scopes its
own ring because teal --accent is 2.6:1 on navy.
EOF
```

---

### Task 3: Flip `TopBar.tsx` to the header tokens

**Files:**
- Modify: `frontend/components/TopBar.tsx` (header tag, wordmark/descriptor, nav links, number span, run-state group, dot, "Next run").
- Modify: `frontend/tests/unit/chip-contrast.test.ts` — update the `--bg-hover` "five places" comment (the TopBar nav hover moves off `bg-bg-hover`).

**Interfaces:**
- Consumes: the `header-*` utilities from Task 2.
- Produces: the navy masthead with light-on-navy contents. Task 4 gives `RibbonControl` the same treatment.

- [ ] **Step 1: Header tag**

`<header className="sticky top-0 z-50 grid grid-cols-[auto_1fr_auto] gap-2 items-center px-3 sm:px-5 h-14 border-b border-border bg-bg-primary/85 backdrop-blur-md">`
→
`<header className="sticky top-0 z-50 grid grid-cols-[auto_1fr_auto] gap-2 items-center px-3 sm:px-5 h-14 border-b border-header-border bg-logo-plate">`

(`backdrop-blur-md` is inert on an opaque bar; drop it. `border-border` → `border-header-border` so the bottom rule is light-on-navy, not the cool `#dfe3e7`.)

- [ ] **Step 2: Wordmark link + descriptor**

The home `<Link className="flex items-center gap-2.5 text-text-primary shrink-0">` →
`text-header-ink`. The descriptor `<span className="hidden lg:block mt-[3px] text-[10px] tracking-[0.14em] text-text-tertiary">` → `text-header-tertiary`. (The `QUANTITATIVE MACRO RESEARCH` descriptor reads 5.48:1 on navy.)

- [ ] **Step 3: Nav links + number**

The link class (lines ~349–353):
```tsx
              className={`shrink-0 first:ml-auto last:mr-auto px-2.5 md:px-3 py-1.5 rounded-md font-medium text-[13px] transition-colors ${
                isActive
                  ? "text-text-primary bg-bg-elevated"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              }`}
```
→
```tsx
              className={`shrink-0 first:ml-auto last:mr-auto px-2.5 md:px-3 py-1.5 rounded-md font-medium text-[13px] transition-colors ${
                isActive
                  ? "text-header-ink bg-header-raised"
                  : "text-header-muted hover:text-header-ink hover:bg-header-raised"
              }`}
```

The number `<span aria-hidden="true" className="num text-text-tertiary mr-1.5 text-[11px]">` → `text-header-tertiary`.

- [ ] **Step 4: Run-state group**

`<div ... className="group relative flex items-stretch text-text-secondary text-[12px] border border-border rounded-md overflow-hidden bg-bg-elevated divide-x divide-border">`
→
`... text-header-muted text-[12px] border border-header-border rounded-md overflow-hidden bg-header-raised divide-x divide-header-border`

The freshness dot (three branches): `bg-text-tertiary`(unknown) → `bg-header-tertiary`, `bg-text-secondary`(live) → `bg-header-ink`, `bg-warning`(stale) → `bg-header-warning`. The `Data {live}` text inherits `text-header-muted` from the group.

The "Next run" `<span className="hidden md:inline-flex items-center px-2.5 py-1 text-[11px] text-text-tertiary whitespace-nowrap">` → `text-header-tertiary`.

- [ ] **Step 5: Update the `--bg-hover` comment in `chip-contrast.test.ts`**

In the `SURFACES` comment (lines ~100–111), change `"appears in exactly five places, none of which contain a chip: … the nav-item hover in TopBar and LensSelector"` to four places — remove "in TopBar" and append:

```
 *  ... the nav-item hover in LensSelector. (TopBar's nav hover moved to
 *  --header-raised when the masthead went navy — ADR-0223.)
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck` (tsc --noEmit) — clean.
Run: `npx vitest run tests/unit/chip-contrast.test.ts` — green (no-hex sweep confirms no literal colour slipped into TopBar).
Read `frontend/components/TopBar.tsx` back and confirm no `text-text-*`/`bg-bg-*`/`border-border` (non-header) utility remains on any in-bar element. The portalled tooltip (uses `card`, `text-text-secondary`, `text-text-tertiary`) stays light — it renders at `document.body`, outside the header.

- [ ] **Step 7: Commit**

```bash
git add -- frontend/components/TopBar.tsx frontend/tests/unit/chip-contrast.test.ts && git commit --only -F - -- frontend/components/TopBar.tsx frontend/tests/unit/chip-contrast.test.ts <<'EOF'
feat: navy masthead — TopBar contents flip to the header ladder

Header solid --logo-plate with a light-on-navy bottom rule; wordmark,
six-phase nav (inactive muted / active raised block), run-state group and
the freshness dot move to --header-* tokens. Geometry, sticky, tooltip
portalling and the scroll-fade mask are untouched.
EOF
```

---

### Task 4: Flip `RibbonControl.tsx`

**Files:**
- Modify: `frontend/components/RibbonControl.tsx` (default button classes).

**Interfaces:**
- Consumes: the `header-*` utilities from Task 2.
- Produces: the three header tool controls (`AskDock`, `LiveNewsDock`, `DataMapDock`) reading as light-on-navy in the bar. Their portalled panels stay light.

- [ ] **Step 1: Update the button classes**

```tsx
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors ${
          active
            ? "border-border-strong bg-bg-elevated text-text-primary"
            : "border-border bg-bg-surface text-text-secondary hover:text-text-primary hover:bg-bg-hover"
        } ${className}`}
```
→
```tsx
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors ${
          active
            ? "border-header-border bg-header-raised text-header-ink"
            : "border-header-border bg-transparent text-header-muted hover:text-header-ink hover:bg-header-raised"
        } ${className}`}
```

(`bg-bg-surface` — white — on a navy bar would be a solid white button; `bg-transparent` lets the navy show and the hover fill supplies the affordance.)

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — clean.
Run: `npx vitest run tests/unit/chip-contrast.test.ts` — green.
Confirm `RibbonControl`'s only consumers are the three header docks (grep `RibbonControl` in `frontend/components/`); the panels they open (`AskWindow`, `LiveNewsWindow`, `DataMapDock`'s overlay) use light `card` classes and are unchanged.

- [ ] **Step 3: Commit**

```bash
git add -- frontend/components/RibbonControl.tsx && git commit --only -F - -- frontend/components/RibbonControl.tsx <<'EOF'
feat: RibbonControl buttons flip to the header ladder

Ask / Live news / Data map read as light-on-navy in the bar; their
portalled panels stay light cards.
EOF
```

---

### Task 5: Full verification + screenshots

**Files:**
- Create: `docs/captures/2026-08-02/navy-masthead-*.png` (screenshots, one folder per date).
- No source changes expected; if a check surfaces a defect, fix it in the same task and re-run.

**Interfaces:**
- Consumes: the complete navy masthead from Tasks 2–4.

- [ ] **Step 1: Full unit + typecheck**

Run: `npm run typecheck` — clean.
Run: `npm run test:unit` — the full vitest suite green (targeted files: `chip-contrast`, `scroll-fade`, `next-run`, `brand-mark`, `phases`, `section-nav` at minimum; the whole suite in CI order).
Run: `npm run build` — green. (Ensure no `next dev` is running — they share `.next`.)

- [ ] **Step 2: Playwright screenshots**

Create the dated folder and capture the masthead on representative pages at desktop and phone. With the Playwright MCP: navigate `/`, `/book`, `/risk`, `/method`; screenshot each at 1440px and 375px. If the MCP is unavailable, use a node script:

```js
// scripts/capture-navy-masthead.mjs (scratch; delete after use)
import { chromium } from "@playwright/test";
const out = "docs/captures/2026-08-02";
import { mkdirSync } from "node:fs";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [path, name] of [
  ["/", "home"],
  ["/book", "book"],
  ["/risk", "risk"],
  ["/method", "method"],
]) {
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${out}/navy-masthead-${name}-${w}.png`, fullPage: false });
    await page.close();
  }
}
await browser.close();
```

**Expected:** the 56px bar renders solid navy at every width; nav, run-state, "Next run" and the three controls are light-on-navy; the mark's white figure reads directly on the plate; the portalled panels (Ask, Live news, Data map) and the run-state tooltip stay light; the bottom rule is a soft white hairline, not `#dfe3e7`.

- [ ] **Step 3: Visual checks on the screenshots**

- The nav active tab shows the raised block; inactive tabs are muted.
- The freshness dot: live = white, stale = light orange, unknown = muted — and the "Data …" word is legible beside it.
- `Tab` through the header: the focus ring is the light cyan (`--header-focus`), visible on navy.
- No console errors: check the Playwright console log for `error` level.

- [ ] **Step 4: Final doc check**

- `docs/captures/2026-08-02/` screenshots exist (the spec promised them).
- `PROGRESS.md` already carries the ADR-0223 row (committed with the decision); no further doc edit unless a defect changed the plan.
- Confirm nothing outside `TopBar`/`RibbonControl` references a `--header-*` token: `grep -rn "header-" frontend/app frontend/components frontend/lib | grep -v "header-border\|header-ink\|header-muted\|header-tertiary\|header-raised\|header-focus\|header-warning"`.

- [ ] **Step 5: Commit any remaining changes**

If a defect fix landed, commit it with explicit paths. Otherwise the four prior tasks' commits already carry the work; this task is verification-only and needs no commit.

---

## Self-review

**Spec coverage:**
- Token ladder (both files, kept in step) → Task 2.
- Solid `bg-logo-plate`, drop blur, `border-header-border` → Task 3 Step 1.
- Wordmark/descriptor/nav/run-state/dot/"Next run" flips → Task 3.
- RibbonControl flip → Task 4.
- Scoped `header :focus-visible` → Task 2 Step 3.
- Header-ladder test block (ink floor, ring/dot 3:1, dot pairing) → Task 1.
- `--bg-hover` "five places" comment → Task 3 Step 5.
- `--logo-plate` fence comment → Task 2 Steps 1 & 4.
- Portalled panels stay light → asserted in Tasks 3 Step 6, 4 Step 2, 5 Step 2.
- ADR-0223 / doc sync → already committed with the decision; Task 5 confirms.
- Verification: tsc, vitest, build, Playwright → Task 5.

**Placeholder scan:** none — every step carries exact classes, tokens, or commands.

**Type consistency:** token names match across tasks (Task 1 reads `PALETTE["header-*"]`; Task 2 defines `--header-*`; Tasks 3–4 use the `header-*` utilities). The dot branches in Task 3 map to the same tokens the Task 1 pairing test asserts.
