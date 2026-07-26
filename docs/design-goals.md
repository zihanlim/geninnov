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

### 3. Direction is glyph + wordmark. Green/crimson reinforce, and nothing else may borrow them

Forest-green `--long` = long, crimson `--short` = short. These are semantics, not
decoration. Interactive/emphasis is `--accent` (crimson-pink); attention is
`--warning` (orange). A proposal that colours `LONG` the same as a hyperlink has
destroyed a semantic to gain nothing — this is the single most common failure
mode in outside mockups.

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
  make it always-on. The three detail panels on `/risk` are collapsed by
  default for exactly this reason.
- **Never trap a page in an inner scroller.** Viewport-locked shells
  (`h-screen` + `overflow-y-auto` on the content) photograph well and break
  Ctrl+F, deep links, and long candidate tables. Full-page scroll always wins.

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
- **Real-time / tick-level anything.** The pipeline runs once a day after the US
  close. A live-ticking UI would misrepresent the cadence of the data.
- **Mobile-first.** Mobile must *work* — and is verified — but comparison tables
  and factor charts are designed for desktop and degrade gracefully, not the
  reverse.
- **The Bloomberg terminal look.** See ADR-0009. The differentiator is the
  visible rigor of the derivation, not visual fidelity to a terminal.
- **An *unlabelled* sidebar glyph rail.** A rail is permitted when it is
  **labelled** and does not cost the layout: collapsed 56px is the default and
  preserves the two-pane position tables; expanded 200px is a reader's explicit
  choice that suppresses them (two panes need 1,304px of content, so a rail
  costs viewport one-for-one — see
  [ADR-0086](adrs/0086-a-labelled-rail-that-collapses-rather-than-a-glyph-rail.md)).
  Unlabelled glyph rails stay refused: they trade clarity for the appearance of
  scale, which is what this non-goal was always about. Four top-bar
  *destinations*. A destination may have
  section sub-routes, and they never appear in the bar — `/method` is two
  chapters (`/method` and `/method/evidence`) behind one header item, and the
  repo has always served `/trades`, `/portfolio` and `/research` as redirects
  behind that same four-item bar. The objection here is to the unlabelled glyph
  rail, which trades clarity for the appearance of scale; it was never a count
  of URLs. See [ADR-0084](adrs/0084-method-splits-by-reader-question-not-by-copy.md)
  for the stop rules that keep this from becoming the rail by increments —
  chiefly: **split by section, never by copy of the same data.**
  `/ask` ([ADR-0087](adrs/0087-a-chat-that-cannot-do-arithmetic.md)) is the
  worked example of the distinction: it is a route, and it is reached from a
  TopBar *control*, because it is a way of READING the book rather than a fifth
  thing the product is. Four destinations, still. If it ever turns up in the nav
  or the rail, that decision has been reversed and needs re-arguing here.
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

## Where the tokens and primitives live

| Concern | File |
|---|---|
| Colour tokens, `.card` / `.badge` / `.num` primitives | `frontend/app/globals.css` |
| Tailwind colour + font scale (compiled — keep in sync with above) | `frontend/tailwind.config.ts` |
| **AA floor + no-hex + palette-drift enforcement** | `frontend/tests/unit/chip-contrast.test.ts` |
| Empty / error / freshness primitives | `frontend/components/status/` |
| Status chip classes (data, so tests can import them) | `frontend/lib/statusChips.ts` |
| `/method` callout tone classes | `frontend/lib/methodTones.ts` |
| Severity + correlation cell colour scales | `frontend/lib/risk/analytics.ts` |
| Method-page prose primitives (`Formula`, `Note`, `Code`, `Stat`) | `frontend/components/method/primitives.tsx` |
| Frozen visual baselines (read-only) | `docs/baseline/screenshots/` |
