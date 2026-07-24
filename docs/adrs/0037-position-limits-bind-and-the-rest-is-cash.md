# 0037 — Position limits actually bind, and what they refuse becomes cash

- **Status:** accepted
- **Date:** 2026-07-24
- **Relates to:** [ADR-0032](0032-edge-carry-value-abstention-sizing.md) (conviction sizing),
  [ADR-0024](0024-recompute-analytics-on-final-book.md) (analytics on the final sized book)

## Context

`/book` published three positions at **33.3% each against a stated 20% single-name
limit** — 167% utilisation — and listed six cap violations, on a page whose own
copy said the caps were enforced. `ARCHITECTURE.md` said the same: *"the documented
20/30/35 caps are now actually enforced."* They were computed, reported, and then
undone.

Three independent defects in `allocate_portfolio`, each of which alone was enough to
void the limits:

**1. A final renormalisation erased every cap.**

```python
# Final normalisation so weights sum exactly to 1.0
total_w = sum(weights)
weights = [w / total_w for w in weights]
```

Capping three names at 20% leaves the weights summing to 0.60 — that *is* the cap
working. Dividing through by 0.60 put all three back to 33.3%. The tighter the cap
bit, the harder this undid it.

**2. Group caps compared the wrong quantity, and skipped small groups.**

The sector and geography passes selected members whose *own* weight exceeded the
*group* cap. Two credit names at 20% each put the Credit sector at 40% against a 30%
limit while neither member individually exceeded 30% — so nothing was capped and the
loop spun ten times doing nothing. A separate guard skipped any group with fewer than
three members, reasoning that "the single-name cap is sufficient", which 2 × 20% =
40% disproves.

**3. Single-name redistribution could push a recipient past the cap.**

The pass ran exactly once. An 88/12 book capped the first name to 20% and handed the
entire 68% excess to the second, leaving it at **80% — four times its own limit**. A
test asserted that $80M as the correct answer.

None of the 385 tests caught any of this, because none exercised a book small enough
for a cap to bind. The failure was invisible precisely when it mattered most.

## Decision

**Caps bind on the quantity they are written about, and are enforced to a fixed
point.**

- Single-name: clamp over-weight names, redistribute the freed capacity across names
  still under the cap in proportion to their current weights, and **repeat** until no
  name exceeds the cap.
- Sector and geography: bind on the **group total**. When a group exceeds its cap,
  every member is scaled by `cap / total`, which preserves relative conviction inside
  the group and does not relocate the concentration into other names. No minimum
  member count.

**Whatever the limits refuse is held in cash — the book is not renormalised back to
100%.**

This is the substantive decision. Forcing full notional into whatever names happen to
clear is exactly what a position limit exists to prevent: the fewer the names, the
harder the book breaks its own published limit, which is precisely backwards. A book
that cannot be filled inside its risk limits should be **smaller, not more
concentrated**. Cash is a position.

The limit *values* (20% single name / 30% sector / 35% geography) are unchanged. They
were never the defect and re-specifying them is an operator decision, not an
implementation one.

## Consequences

**Diversified books are essentially unaffected; concentrated ones shrink, correctly.**
Measured on the live universe:

| Book | Deployed | Largest name |
|---|---|---|
| 8 names across sectors/geos | 98% | 12.5% |
| 10 names across sectors/geos | 95% | 10.0% |
| Today's 3-name book (TLT/GLD/EFA) | 60% | 20.0% |
| 6-name all-US credit | 30% | 5.0% |

That asymmetry is the entire point of a limit. The 30% on an all-credit book is not a
malfunction — such a book genuinely violates a 30% sector limit, so 30% is all it can
legally hold.

**A `$100M Book` will now often show less than $100M deployed, and the UI has to say
why.** `/book` states the cash explicitly in its plain-English lead — *"$40.0M is held
in cash: at 3 names the book cannot take more without breaching its own position
limits"* — and the Deployed card carries the same in its hint. A reader told "sized
across $100M" while the notionals total $60M is owed the difference and the reason.

**Sizing is now genuinely conviction-driven.** Redistribution previously inflated a
low-conviction name to 80% merely because a high-conviction one was capped, which is
filling space, not sizing. Excess now stops at names that can legitimately take it.

**This makes the small-book problem visible rather than hiding it.** A 60%-deployed
book is an honest read of a thin opportunity set — and it raises the value of the
outstanding Q1 gap (single names, for cross-sectional breadth), because more genuinely
independent ideas is the only way to deploy more capital *without* relaxing a limit.

**Cost.** Three tests encoded the broken behaviour and were rewritten, two of them
asserting an explicit cap breach as correct. Three new tests cover the cases that had
no coverage: caps binding with the remainder in cash, a group cap binding on the group
total, and redistribution not exceeding the cap. 388 backend tests green.
