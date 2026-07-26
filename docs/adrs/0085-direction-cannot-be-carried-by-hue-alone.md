# ADR-0085 — Direction cannot be carried by hue alone

**Date:** 2026-07-26
**Status:** Accepted
**Amends:** [../design-goals.md](../design-goals.md) §3
**Relates to:** [0009](0009-frontend-design-language.md), [0084](0084-method-splits-by-reader-question-not-by-copy.md)

## Context

`docs/design-goals.md` goal 3 reads:

> **Direction owns green/crimson. Nothing else may borrow them.**
> Forest-green `--long` = long, crimson `--short` = short. These are semantics, not
> decoration. […]
> **Test:** desaturate the page. Can you still tell longs from shorts? Can you still
> tell what's clickable?

**That test has never passed, and cannot pass.** It was written as a check on
*misuse*, but it fails on the tokens themselves, before any misuse is involved.

WCAG relative luminance of the three inks as shipped:

| Token | Hex | Relative luminance |
|---|---|---|
| `--long` | `#126e53` | 0.1191 |
| `--short` | `#9f172a` | 0.0815 |
| `--accent` | `#c50c3e` | 0.1248 |

Which gives, desaturated:

| Pair | Contrast | What the goal claims you can do |
|---|---|---|
| `--long` vs `--short` | **1.29:1** | "tell longs from shorts" |
| `--long` vs `--accent` | **1.03:1** | "tell what's clickable" |
| `--short` vs `--accent` | 1.33:1 | — |

1.03:1 is the same grey. A greyscale print, a monochrome display, a red-green
colour-vision deficiency, or a screenshot pasted into a black-and-white document
all collapse long, short and "clickable" into one value.

**There is no palette that fixes this.** An ink clearing AA 4.5:1 as small text on
white needs relative luminance ≤ 0.1833. Two inks both satisfying that are at most
~3.3:1 apart, and at that separation the darker one sits ~1.2:1 from
`--text-primary` (`#1c1815`) — indistinguishable from body copy. The constraint is
arithmetic, not a matter of picking better hues. Goal 8 (the AA floor) and goal 3's
desaturation test cannot both be satisfied by colour alone.

Separately: **`--brand` and `--short` are byte-identical** (`#9f172a`). Two names for
one colour means "brand emphasis" and "short position" render identically and no
reader — or contributor — can tell which was intended.

This was found while preparing to enforce goal 3 mechanically. The enforcement work
was sound but would not have moved either number: every candidate rule policed *call
sites*, and this is a *token* property.

## Decision

**1. Direction is carried by glyph and wordmark. Hue reinforces; it never carries.**

Goal 3's requirement becomes: any element whose meaning is a book direction must
render a `▲`/`▼` glyph or a `LONG`/`SHORT` wordmark alongside the colour. The colour
is redundant encoding, which is what colour should always have been here.

This is already true where it matters. Both genuine direction-chip sites —
`components/risk/AttentionCrowding.tsx:29,31` and
`components/risk/PositionRiskAttribution.tsx:276` — already emit the wordmark, and
the `/book` position panels already carry `▲`/`▼`. Inline signed values already carry
their sign from `fmtSigned`'s `+`/`−`. The channel exists; this ADR makes it a
requirement rather than a habit.

**2. The prohibition survives, narrowed to where it bites.** `--long`/`--short` may
not be used for status, severity, verdict, regime or chrome. That prohibition is
about *meaning*, and it holds regardless of the luminance finding: a green
"success" chip beside a green "long" chip teaches a reader that green means two
different things on one page.

**3. `--brand` is deleted**, its call sites moved to `--short` or `--accent` by
intent.

**4. The scope of mechanical enforcement is the enumerated chip vocabularies** —
`lib/statusChips.ts`, `lib/methodTones.ts`, the severity maps in
`lib/risk/analytics.ts`, and the `.badge-*` / `.dir-pill-*` `@apply` rules — **not**
inline signed-value colouring.

That scoping is deliberate and is recorded so a later pass cannot widen it silently.
The evidence: of the eleven chip-vocabulary sites using a direction token, **nine are
misuse** (`success`/`failure` at `MethodBody.tsx:272,273`, pass/fail at `:2396,2398`,
`risk-on`/`risk-off`/`recession` at `RegimeHero.tsx:31,101`, a *tier count* at
`DiscoveredThemes.tsx:111`, correlation `inverse` at `CorrelationMatrix.tsx:30`,
`ThesisBlock.tsx:43`) and **two are correct**. The misuse concentrates in the chip
layer. Inline signed values already carry a `+`/`−` and are a separate decision.

**Widening clause:** extending enforcement to inline signed-value colouring, to
prose, or to a whole-tree containment module requires a new ADR.

## Consequences

**Good**

- The design goal states something true, and something a contributor can satisfy.
- The redundant-encoding requirement is a genuine accessibility improvement, not
  only a semantic one — it is the fix for colour-vision deficiency, which no
  contrast ratio addresses.
- Nine chips stop claiming to be directions.
- One colour, one name.

**Costs, named**

- **A whole-tree containment module was considered and rejected.** It would have
  routed ~210 correct call sites through a new `lib/direction.tsx` with a closed
  subject registry. It buys real architectural tidiness and would make a future
  token change a one-file edit — but it does not fix the luminance problem, which
  was its headline justification, and it is ~210 sites of churn to correct nine.
  If direction ink is ever needed in a genuinely new context, revisit it.
- **Enforcement will not verify meaning.** A test can see that a chip vocabulary
  does not name a direction token. It cannot see that `corr >= 0 ? "short" : "long"`
  is a risk verdict wearing direction's clothes. `CorrelationMatrix.tsx:229` is
  fixed here by hand and is not guarded afterwards.
- **The desaturation test is weakened, not repaired.** After this change a
  desaturated page distinguishes long from short by *glyph*, not by tone. That is
  the achievable guarantee. Anyone who wanted tonal separation should know it was
  never available at AA.
- Goal 3's original wording was, in one respect, aspirational rather than
  descriptive for the whole life of the palette. Nothing that shipped under it was
  wrong on purpose.
