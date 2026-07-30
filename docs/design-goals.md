# Andromeda — Design Goals

Standing criteria for judging any proposed UI change: a mockup, a redesign, a new
panel, a palette suggestion. ADRs record *decisions already taken*; this file
records *the bar a new proposal has to clear*. If a change conflicts with a goal
below, the change is wrong unless it argues the goal down first — in a new ADR.

Read this before evaluating an external mockup. It is the reason a slick,
well-executed comp can still be a downgrade.

## The one-sentence version

Andromeda publishes a $100M book once a day and has to be believed. Every
design goal below serves believability over impressiveness.

## Goals, in priority order

### 1. No naked numbers

Every figure on screen traces to a persisted source (`table.column`) or is
labelled as a browser-side estimate. A number a reader cannot follow back to its
origin is worse than no number, because it spends credibility we then can't
rebuild. See [ADR-0010](adrs/0010-citation-footnotes-everywhere.md).

**Test:** point at any number on the page. Can a reader find where it came from
without asking? If the answer is "it's in the pipeline somewhere", it fails.

### 2. Absence is stated, never filled

A null renders as `—` **plus the cause** — not as `0.00`, not as a plausible
guess, not as a silently omitted row. "No data" and "zero" are different claims
and the UI must never conflate them. `EmptyState` and `explainGap` exist for
this; use them. See [ADR-0058](adrs/0058-explanations-are-owed-per-empty-slot.md)
and [ADR-0066](adrs/0066-not-computable-must-persist-as-null.md).

**Test:** unplug a table. Does the page explain what's missing and how to fix it,
or does it just go quiet?

A two-state verdict hides this. `assessStaleness` returned `stale: false` both when it had
judged a book current AND when it had no usable `run_date` to judge — so a record with a
null date rendered with **no freshness signal at all**, which reads as currency on a page
of $100M positions. `stale: false` is itself a claim ("no run was missed") and there was no
basis for it. Any boolean that can mean *both* "measured and fine" and "could not measure"
needs a third state with a stated cause — `verdict: current | stale | unjudgeable` plus
`unjudgeableReason`, the same rule `pick_outcomes.void_reason` enforces by CHECK constraint
([ADR-0090](adrs/0090-a-published-pick-must-be-falsifiable.md)).

### 3. Direction is glyph + wordmark. Green/crimson reinforce, and nothing else may borrow them

Forest-green `--long` = long, crimson `--short` = short. These are semantics, not
decoration. Interactive/emphasis is `--accent` (teal since 2026-07-29 — was
crimson-pink, [ADR-0164](adrs/0164-the-accent-and-the-short-ink-were-the-same-colour.md));
attention is `--warning` (orange). A proposal that
colours `LONG` the same as a hyperlink has destroyed a semantic to gain nothing —
this is the single most common failure mode in outside mockups.

The accent moved because this goal was failing against its own test, from the
inside. Crimson-pink sat 8° of hue from `--short`, and measured under simulated
CVD it was ΔE 7.7 (protanopia) and 8.6 (deuteranopia) from the SHORT ink — below
the ~10 threshold at which two colours stop being separable, for ~6% of males.
The hyperlink *was* the direction. Teal `#00687a` measures 32.1 / 51.8 against
`--short` and 26.2 / 25.3 against `--long`, and clears AA with more margin than
crimson-pink had after two darkenings. Known regression: ΔE 4.6 from `--long`
under tritanopia (~0.01% prevalence), which the glyph-and-wordmark rule below is
what makes survivable — so this goal and ADR-0085 are now coupled, and relaxing
the wordmark rule breaks the arithmetic that justified the accent.

Note what this goal still cannot do: it is enforceable by eye against an incoming
proposal, and `chip-contrast.test.ts` does not cover it — that test measures a
foreground against its **background**, which is a different question from two
**foregrounds** that mean different things. No separation floor is asserted
anywhere, deliberately: it needs an argued threshold and a rule for which pairs
are adjacent enough to matter. Until then this is a measurement to re-run, not a
gate that will catch you.

**Every element whose meaning is a book direction must render a `▲`/`▼` glyph or a
`LONG`/`SHORT` wordmark beside the colour.** Hue is redundant encoding here, never
the carrier — because it cannot be the carrier. Measured relative luminance:
`--long` 0.1191, `--short` 0.0815, `--accent` 0.1248 — **1.29:1** between long and
short, **1.03:1** between long and the interactive accent. Desaturated, those are the
same grey, and always have been. No palette fixes it: an ink clearing AA 4.5:1 on
white needs luminance ≤ 0.1833, so two such inks are at most ~3.3:1 apart, at which
point the darker sits ~1.2:1 from body text. Goal 8 and tonal direction-separation
cannot both hold. See [ADR-0085](adrs/0085-direction-cannot-be-carried-by-hue-alone.md).

**Test:** desaturate the page. Can you still tell longs from shorts *by glyph or
wordmark*? Then: does any chip that is **not** a direction use `--long`/`--short`?
The second half is machine-enforced over the enumerated chip vocabularies
(`lib/statusChips.ts`, `lib/methodTones.ts`, `lib/risk/riskChips.ts`, the severity
maps, and the `.badge-*` / `.dir-pill-*` rules) **and over both spellings of an
inline chip** — `badge badge-short` *and* the utility form `badge bg-short-dim
text-short`. The second spelling is not a footnote: sweeping for the first alone let
three shipped chips walk past the 2026-07-26 goal-3 pass. A chip is direction tint
**plus** direction ink; that pair is the signature, and a legitimate direction chip
has `.badge-long` / `.dir-pill-long` to use instead.

Inline signed-value colouring is deliberately out of scope — it already carries its
`+`/`−` — and widening that scope needs its own ADR. Note what that exemption
actually rests on: the glyph says what the hue says. Where a colour is keyed to a
*verdict* rather than to the sign — a `higherIsWorse` delta chip, a breach, a
crowding flag — the exemption does not reach it, because there the glyph and the hue
can disagree, and on `/risk` one span was printing the word "long" in crimson.

### 4. Warm paper, not the interchangeable dark dashboard

The Ledger identity — cream paper, warm hairlines, ink-dark text, JetBrains Mono
for every figure, Hanken Grotesk for prose — is a deliberate refusal of the
dark-neon fintech default. It is the app's personality and it is not up for
casual reskinning. Tokens live in `frontend/app/globals.css` and
`frontend/tailwind.config.ts`, **which must change together** — Tailwind
compiles colours to literal RGB and does not read the `:root` variables.

This supersedes ADR-0009's "dark mode retained" clause; the rest of ADR-0009
(research-first, auditable, narrative over density) still holds.

**One navy exists, and it is fenced to the logo.** The supplied mark is a white
figure on `#161b38`, so adopting it put a dark ground in a light product
([ADR-0113](adrs/0113-the-mark-is-the-artwork-and-the-plate-is-fenced.md)). That
is a real widening of this goal and is recorded rather than absorbed. `--logo-plate`
is a token *only* so the palette test can see it — it is not a surface, not a chip,
not an ink, and **no Tailwind utility compiles from it**, so `bg-logo-plate` gets
you nothing and there is no accidental path from the mark to a navy panel. A
proposal that reaches for it for anything but the mark is reaching for the dark
dashboard by increments, which is what this goal is about.

### 5. Affordances match capability

No control may imply it can change the book. The frontend shows no `COMMIT`, no
`RECALCULATE`, no `SAVE`. A button that implies a capability the system does not
have is a lie with a hover state. Export is fine — it acts on data already in
the browser.

This used to read "the frontend reads Supabase directly and writes nothing",
which was the *mechanism* rather than the goal. `/ask` (ADR-0087) added the
first control that triggers server-side work, so the mechanism no longer states
it and the goal is stated directly instead. The bar `/ask` had to clear, and
which any future server-side control must clear:

- it writes nothing to any domain table (its only write is a request counter in
  a table that exists for no other purpose);
- it reads with the anon key — the same rows the browser could already fetch —
  so it can reveal nothing a visitor could not;
- it cannot re-run, re-size, re-rank or re-publish anything.

The capability its affordance implies is "ask a question about the published
run". That is exactly the capability that exists.

**Test:** for every control, name the code path it triggers. No path, no
control. Then: if that path reaches a server, name what it can change. "Nothing
in the book" is the only acceptable answer.

### 6. Prose carries the why; mono carries the figure

A reader gets the reasoning in sentences and the value in tabular mono. Neither
substitutes for the other. Rows explain their own side in plain English *before*
the reader decodes any σ or basis-point value — the rationale is never hidden
behind an expand.

### 7. Density serves comparison, not screenshots

Dense is correct when a reader is comparing rows. It is wrong when it hides the
single fact they came for. Two consequences:

- **Collapse optional detail behind `<details>`**, don't delete it and don't
  make it always-on. The detail panels already collapsed on `/book` and `/risk`
  are collapsed for exactly this reason.

  **NARROWED, 2026-07-30 (owner's direction): this permits what exists and no
  longer prescribes MORE.** ADR-0172 was scoped with new collapsing on
  `/mandate` — which had zero collapsed blocks across 5.3 screens — and the
  owner refused it: every card stays visible on arrival. It turned out
  unnecessary, which is the useful part. Moving each block to the phase whose
  question it answers took `/mandate` from 5.3 to **3.6 screens** and 232 to
  **122 numerals** on its own, with nothing hidden. So the remedy for a page that
  is too long is **first check whether its content belongs there**; a disclosure
  is what you reach for when it does. Existing `<details>` are untouched — this
  narrows the rule, it does not reverse it.
- **Never trap a page in an inner scroller.** Viewport-locked shells
  (`h-screen` + `overflow-y-auto` on the content) photograph well and break
  Ctrl+F, deep links, and long candidate tables. Full-page scroll always wins.

  **This was conditional for a day and is absolute again.**
  [ADR-0103](adrs/0103-the-themes-page-is-a-terminal.md) took a measured,
  properly-argued exemption for `/`;
  [ADR-0106](adrs/0106-the-themes-page-is-a-grid-that-scrolls.md) reverses it on
  what the exemption produced. A locked shell divides a fixed height between
  panes with `minmax(0,Nfr)` rows, so **every pane must clip whatever does not
  fit** — the regime pane rendered "FACTOR TILT OF BOO" and printed five factor
  betas as "+0"/"-0" against real values of −0.50, +0.22, +0.32, +0.43, −0.38,
  behind two scrollbars, with six scroll contexts on one screen. A tilt of −0.50
  displayed as −0 is not a compressed number, it is a **wrong** one, which is
  goal 1 violated by the layout.

  The lesson is narrower than "terminals are bad": **a pane may not own a height
  it cannot measure.** Content-sized rows (`auto` + `items-start`) give the same
  dense side-by-side reading with nothing cut. The one place an inner scroller
  remains legitimate is a floating popover — bounded by the viewport by
  definition, so `max-h` + `overflow-y-auto` is the only way it can hold a long
  list. Goal 7 is about trapping a *page*, not a dock.

### 8. Accessibility is a floor, not a polish pass

WCAG AA 4.5:1 on small text against **every surface it can land on** — the page,
a card, and a raised/hovered row. Visible `:focus-visible` rings.
Keyboard-operable disclosures with `aria-expanded`. `sr-only` captions on every
data table.

**This one is machine-enforced.** `frontend/tests/unit/chip-contrast.test.ts`
imports the real chip definitions, resolves them against the real palette,
composites translucent tints over each surface, and fails under 4.5:1. It also
forbids hex literals in `app/`, `components/` and `lib/`, and asserts
`globals.css` and `tailwind.config.ts` agree. Do not exempt a chip to make it
pass; fix the colour.

Hand-checking was tried first and missed four things, which is why the test
exists:

- A chip is *foreground over background over surface*. Checking any two of the
  three proves nothing — `--warning` was measured as plain text on paper and card
  (both passing) while every badge rendered it over its own tint (all failing).
- A hex literal is invisible to a token sweep. The 2026-07-24 pass moved the
  tokens and left `#f0883e`, `#3a2615`, `#e8833a` and `#e11048` behind in
  components.
- Tailwind's opacity modifier **replaces** a colour's alpha, it does not compound
  it. `bg-long-dim/60` is 60% of full-strength green, not 60% of an 11% tint —
  which shipped a 2.29:1 chip that read as intentional.
- Three separate code comments asserted "AA-compliant" about a colour that was
  not. Prose does not measure.

**Test:** run the suite. Then tab through the page — can you reach and toggle
everything?

## Non-goals

Stated so nobody re-litigates them by accident:

- **Dark mode.** Not shipping one. Two themes doubles the contrast-audit surface
  for an audience that reads a daily publication in daylight.
- **Real-time / tick-level anything** *in the book's own data*. The pipeline runs
  once a day after the US close. A live-ticking UI would misrepresent the cadence
  of the data. **One declared exception:** the live news panel embeds
  third-party broadcast streams
  ([ADR-0104](adrs/0104-a-live-news-panel-that-cannot-be-cited-and-says-so.md)).
  It is scoped by three things — it carries no derived data, it prints the book's
  `run_date` beside the stream so a moving picture cannot imply a moving book, and
  it declares in the panel that nothing there is citable. **It opens from a TopBar
  control beside `Ask`, on every page, as a persistent draggable window that
  survives navigation** (2026-07-27, owner's direction); ADR-0104 described it as a
  panel on `/`, which is where it started. Its `run_date` now reads from
  `pipeline_runs`, not from the `themes.updated_at` TopBar already had, which lags
  the run it belongs to.

  **State the widening plainly:** the exception used to end when you left `/`, and
  now a live picture can follow a reader across every page. What bounds it is
  unchanged and still enforced — it carries no derived data, no figure traces to it,
  `/ask` cannot quote it, and the cadence caveat travels inside the window. And the
  privacy half of ADR-0104 is *stronger*, not weaker: the player is mounted only
  while the window is EXPANDED, so a collapsed tab makes no request to Google at
  all, and on phones the window opens collapsed by default. The non-goal still binds
  everything the pipeline produces: **no figure on this site ticks.**
- **Mobile-first.** Mobile must *work* — and is verified — but comparison tables
  and factor charts are designed for desktop and degrade gracefully, not the
  reverse.
- ~~**The Bloomberg terminal look.**~~ **Reversed for `/` only**, by
  [ADR-0103](adrs/0103-the-themes-page-is-a-terminal.md). The Themes page is a
  viewport-locked pane grid at `≥1024px`. What the non-goal was actually
  protecting still holds everywhere: the differentiator is the visible rigor of
  the derivation, not visual fidelity to a terminal, so a pane earns its place
  by showing a derivation more compactly — never by looking more like a trading
  desk. The **palette** is unchanged (goal 4); a terminal on warm paper is still
  warm paper. `/book`, `/risk` and `/method` are unaffected.
- **An *unlabelled* sidebar glyph rail.** A rail is permitted when it is
  **labelled** and does not cost the layout: collapsed 56px is the default and
  preserves the two-pane position tables; expanded 200px is a reader's explicit
  choice that suppresses them (two panes need 1,304px of content, so a rail
  costs viewport one-for-one — see
  [ADR-0086](adrs/0086-a-labelled-rail-that-collapses-rather-than-a-glyph-rail.md)).
  Unlabelled glyph rails stay refused: they trade clarity for the appearance of
  scale, which is what this non-goal was always about. The objection is to the
  unlabelled glyph rail; it was never a count of URLs.

  **SUPERSEDED ON THE COUNT, 2026-07-30. The nav is now SIX phase tabs, and this
  section is kept because its reasoning is still the bar — only its arithmetic
  changed.** [ADR-0170](adrs/0170-the-navigation-is-the-process.md) replaced the
  four object-shaped destinations with one tab per phase of the investment process
  (`01 Mandate · 02 Alpha · 03 Risk · 04 Construction · 05 Execution ·
  06 Attribution`), at the owner's direction, on the ground that **the sequence is
  what this artefact demonstrates** and a numbered strip teaches it before a reader
  has read a word. [ADR-0172](adrs/0172-every-phase-answers-its-own-question-above-the-fold.md)
  then renamed phase 3 to `Risk`.

  **The rule that replaces "four destinations":**

  > A tab is a PHASE of the process, and the set of tabs is the whole process in
  > order. A surface that is not a phase does not get one — it is a section of a
  > phase, or a TopBar control. Adding a tab means arguing that the process has
  > another step; it can no longer be argued as "this is a different object".

  Two things follow, and both have already been tested against:

  - **`/method` is off the nav**, because the method chapters explain *every* phase —
    naming them as one would be false. It is reached from the process map and by URL.
  - **`/execution` keeps a tab while rendering no figures**, because a sequence that
    skips 5 reads as a missing page. The boundary is the content: the book is a
    recommendation (ADR-0040), so no fill, borrow cost or slippage exists to report.

  **What did NOT change, and is still the bar.** The ADR-0151 → ADR-0152 worked
  example stands as the test a new SURFACE has to pass. `/portfolio` was un-retired as
  a fifth destination on 2026-07-29 and retired again the same day. The argument for
  it was correct as far as it went — the HELD book is a genuinely different object
  from the published one, not the duplicate ADR-0025 retired. It was still wrong,
  because being a distinct object is necessary and **not sufficient**: `task.md` asks
  for "top five long and short trades, and why" and for a daily theme process, and
  nothing in either question asks what the book EARNED. A true page nobody asked for
  still costs a reader the attention it takes to rule out, and a page reporting NAV
  invites "what is your track record?" — which the data cannot answer and
  ADR-0090/0112 already refuse to claim. Under the new rule that page fails a second
  time and for a cleaner reason: reporting NAV is not a phase of choosing a book.

  See [ADR-0084](adrs/0084-method-splits-by-reader-question-not-by-copy.md) for the
  stop rules that keep this from becoming the rail by increments — chiefly: **split by
  section, never by copy of the same data.** `/ask`
  ([ADR-0087](adrs/0087-a-chat-that-cannot-do-arithmetic.md)) is still the worked
  example of the distinction: it is a route reached from a TopBar *control*, because it
  is a way of READING the book rather than a step in producing one. If it ever turns up
  in the nav or the rail, that decision has been reversed and needs re-arguing here.
- **A chatbot that answers from the model's own knowledge.** `/ask` may only
  answer from values a tool fetched this turn. When the tools come back empty,
  the absences ARE the answer — the agent says what is missing, and does not
  reach for what it happens to know about markets. A figure it cannot trace is
  marked untraceable in the prose rather than quietly shipped.

## Evaluating an external mockup

Run this in order. Most comps fail at 2 or 3.

1. Does it invent data or capability the backend doesn't have? → reject those parts outright.
2. Does it reuse the direction colours for something that isn't direction? → reject the palette.
3. Does it show absence as zero, or drop the "why" prose? → reject the density.
4. Does it lock the page into a fixed-height shell? → reject the shell.
5. What's *left*? That's the adoptable set — usually layout, hierarchy and chip
   contrast, rarely colour or typography.

A worked example of this triage — four Stitch comps, five adoptions, five
refusals — is recorded in `PROGRESS.md` under 2026-07-25.

**Four passes in, the yield curve on outside comps is 5 → 2 → 0 → 2**, and the
shape of it is the useful part. The first pass took two structural ideas; the
second took the horizontal axis (2026-07-26); the third returned **zero**; the
fourth (2026-07-29, `stitch_andromeda_systematic_trading_platform.zip`) returned
two — and **neither was a design the comp drew.** Both were defects its screens
exposed in what already ships: a source board that omitted an entire corpus, and
a spend figure `/ask` computed and never rendered
([ADR-0161](adrs/0161-a-corpus-the-board-could-not-see.md)).

Two things follow for the next comp:

- **Step 5's "what's left" is now usually nothing.** The styling axis is
  exhausted — palette, typography and chip geometry have lost four times, and a
  fifth measurement of a Material ladder against this palette is not a good use
  of an afternoon. Say so and move on.
- **Ask what question the comp is asking, not what it draws.** A screen that
  invents every number on it can still be pointing at a question the real product
  answers badly. That is where the last two adoptions came from, and it is the
  one part of the exercise that has not stopped paying.

Before concluding a comp's layout beats what ships, **measure the live pages
first**. The 2026-07-29 pass found the comps' entire grid vocabulary — top
stat-tile row, paired two-column sections, in-page section nav, labelled
collapsible rail — already shipping, some of it adopted from an earlier comp and
since forgotten. The stale "still pending" note in `PROGRESS.md` was more
persuasive than the code, and it was wrong.

## Where the tokens and primitives live

| Concern | File |
|---|---|
| Colour tokens, `.card` / `.badge` / `.num` primitives | `frontend/app/globals.css` |
| **The brand mark** (one path, three renderers, drift-tested) | `frontend/lib/brand.ts` → `components/BrandMark.tsx`, `app/icon.svg`, `app/apple-icon.png` |
| Tailwind colour + font scale (compiled — keep in sync with above) | `frontend/tailwind.config.ts` |
| **AA floor + no-hex + palette-drift enforcement** | `frontend/tests/unit/chip-contrast.test.ts` |
| Empty / error / freshness primitives | `frontend/components/status/` |
| Status chip classes (data, so tests can import them) | `frontend/lib/statusChips.ts` |
| `/method` callout tone classes | `frontend/lib/methodTones.ts` |
| Severity + correlation cell colour scales | `frontend/lib/risk/analytics.ts` |
| Method-page prose primitives (`Formula`, `Note`, `Code`, `Stat`) | `frontend/components/method/primitives.tsx` |
| Frozen visual baselines (read-only) | `docs/baseline/screenshots/` |
