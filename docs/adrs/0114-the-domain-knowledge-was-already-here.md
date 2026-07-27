# ADR-0114: The domain knowledge was already here, and one of its numbers had the sign backwards

**Status:** Accepted
**Date:** 2026-07-27
**Related:** [ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md), [ADR-0074](0074-stress-both-tails-not-just-the-crash.md), [ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md), [ADR-0012](0012-citation-guardrail-llm-defense.md), [ADR-0066](0066-not-computable-must-persist-as-null.md), [ADR-0093](0093-a-published-book-that-changes-must-say-so.md)

## Context

Bar 3 in `docs/GOAL.md`, from a quantamental PM's account of where alpha lives:

> **A horizontal model has no domain knowledge.** The `reason_picks` prompt carries macro, regime, theme table, factor table, book metrics, scenarios, risk, candidates and news. It carries **nothing about what matters for a specific name or sector.**

That was accurate. The obvious reading — a general model lacks domain expertise, so buy or build some — is the expensive one and it is not what the evidence supports.

**This repo is full of per-name domain judgement that never reached the prompt.**

- `scenario_analysis.SCENARIOS[].base_asset_shocks` — reviewed, hand-authored responses per name to six shocks. That ARKK is marked +25% in a melt-up is a statement someone made about what ARKK *is*.
- `cot_fetcher.UNMAPPED_REASON` — per-sector prose on why a sector has no futures contract: *"Miners are equity claims on a mining business — levered to the metal, but carrying operating cost, jurisdiction and financing risk the metal does not have... treating it as such would manufacture coverage."* That is sector knowledge, sitting in a module the prompt never read.
- `sanctions_exposure.EXPOSURE_MECHANISM` — the channel by which a jurisdiction bites.
- `factor_exposures` — a beta vector *is* a statement about what drives a name, and `r_squared` says how much of it is explained.

## Decision

**Assemble a per-candidate dossier from what the system already records, and add nothing.**

`position_dossier.dossier_block` emits a `WHAT MOVES EACH NAME` section: identity (sector / geography / asset class), material factor loadings with their fit, the reviewed stress responses, whether external positioning can observe the name *or the stated reason it cannot*, and any sanctions channel.

**Every line traces to a persisted value or a reviewed constant. Nothing is generated.** A prompt section that invited the model to supply domain knowledge would be inviting precisely the fabrication the citation guardrail exists to catch ([ADR-0012](0012-citation-guardrail-llm-defense.md)) — and it would arrive without a source key, so the guardrail could not adjudicate it.

It also **does not tell the model what to conclude**. "ARKK is a high-beta growth proxy" is an opinion this repo has not measured. "+25% under melt-up, −25% under VIX spike, from the reviewed calibration" is the evidence for that reading, and the reading is the reasoner's job.

Three smaller rules, each guarding a way this could quietly lie:

- **A loading below 0.25 is omitted**, not listed. Inside the noise of a 252-day single-name regression, and listing it pads the prompt with non-findings.
- **A weak fit is labelled.** Below R² 0.10 the betas are decoration and the block says so, using the same threshold the L5 screen already applies.
- **A not-computable beta is absent, never 0.00** ([ADR-0066](0066-not-computable-must-persist-as-null.md)). `beta_umd` is null for every asset today; rendering it as zero would assert that no momentum exposure was found where none was measured.

## What assembling it immediately exposed

**`S1_vix_spike` paid `SVXY: +0.20`, commented "short-VIX benefit".**

SVXY is a **−0.5× inverse VIX** product. Long SVXY is *short volatility*, so a VIX spike above 30 is the event that destroys it — it fell roughly 90% in February 2018. `S4_credit_widening` carried the same error at `+0.15`, rationalised as *"short credit benefit"*, and SVXY has no credit exposure at all.

The comments preserve the reasoning that produced it: *"we are short VIX, this is a VIX scenario, so we gain"* — **confusing short volatility with short the scenario**.

The same file already had it right in S6: `-0.18, "filed under 'Rates' but is short-vol; VIX spikes here"`. One asset, one file, contradictory entries.

**The measurement settles it.** `factor_exposures` for 2026-07-27: `beta_mkt +2.08`, R² 0.68 — a *leveraged risk-on proxy*. Against S1's own stated shock of −18% market, the factor path implies about **−37%**. The table said **+20%**: a 57-point error.

`DEFAULT_TICKER_BETAS` compounded it at `"mkt": -0.60` — wrong sign *and* 3.5× wrong magnitude — and that fallback fires exactly when live FF5 data is missing, which is when nobody is checking.

**It mattered on the live book.** SVXY was the second-largest position at 10.79%, and the optimizer had *increased* it from 6.13%. `/risk`'s stress table was telling a reader the book **gains 20%** in a vol spike on the position that would be hit hardest.

This is [ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md)'s own sentence, arriving in a second place: *"a wrong side has no symptom. It renders cleanly, reads plausibly, and is simply false."* That ADR fixed the sign in the COT mapping and added a test asserting the flipped and unflipped comparisons disagree. **Nobody checked the scenario table for the same class of error.**

## Consequences

**Corrected:** S1 to −0.35, S4 to −0.15, and the fallback beta to +2.08, each carrying the reasoning and the measurement in a comment rather than a bare number.

**Guarded, by property rather than by value:** SVXY must be negative in *every* risk-off scenario and positive in the melt-up, and no leveraged long-equity proxy may carry a negative fallback market beta. Those tests fail on the class of error, not on the instance.

**The published stress figures change materially at the next run** — from +20% to −35% on the largest single line of S1. [ADR-0093](0093-a-published-book-that-changes-must-say-so.md) logs it to `book_revisions` with a reason on the upsert, which is exactly the case that mechanism exists for.

**The dossier is what made it visible.** Putting S1 `+20%` and S6 `−18%` for one asset on adjacent lines is the whole of the diagnosis. That is an argument for assembling evidence per subject rather than per source: the contradiction was always in the file, and reading it by scenario — the way the file is organised — hid it.

**A note on what bar 3 turned out to be.** It reads as a request for domain expertise the system lacks. What it actually surfaced is that the system had the expertise and had not routed it — and that one piece of it was wrong in a way only a reader who saw it *beside its siblings* would catch. Buying a data source would not have found this.
