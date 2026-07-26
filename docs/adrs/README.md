# Architecture Decision Records

One ADR per file. Immutable once accepted â€” superseded ADRs are marked `superseded by ADR-NNNN` rather than rewritten.

## Index

| ID | Title | Status | Date |
|---|---|---|---|
| [0001](0001-supabase-over-postgres.md) | Supabase over self-hosted PostgreSQL | accepted | 2026-07-21 |
| [0002](0002-vercel-for-frontend.md) | Vercel for frontend hosting | accepted | 2026-07-21 |
| [0003](0003-daily-cron-over-fastapi.md) | Daily cron over real-time FastAPI backend | accepted | 2026-07-21 |
| [0004](0004-no-redis-in-phase1.md) | No Redis for caching | accepted | 2026-07-21 |
| [0005](0005-vader-over-paid-sentiment.md) | VADER over paid sentiment API | accepted | 2026-07-21 |
| [0006](0006-minmax-over-zscore-hypescore.md) | Min-max normalization over z-scores for HypeScore | **superseded by [0042](0042-absolute-hype-subscores.md)** | 2026-07-21 |
| [0007](0007-two-method-theme-discovery.md) | Two-method theme discovery (LDA + embedding clustering) | accepted | 2026-07-21 |
| [0008](0008-tier1-macro-anchors-practitioner.md) | Tier 1 macro anchors defined by practitioner judgment | accepted | 2026-07-21 |
| [0009](0009-research-first-design-philosophy.md) | Research-first design philosophy (vs Bloomberg-terminal aesthetic) | accepted | 2026-07-21 |
| [0010](0010-citation-footnotes-everywhere.md) | Citation footnotes on every numeric claim | accepted | 2026-07-21 |
| [0011](0011-theme-derivation-drawer.md) | Theme Derivation Drawer (raw signals â†’ normalized â†’ weighted â†’ final) | accepted | 2026-07-21 |
| [0012](0012-citation-guardrail-llm-defense.md) | Citation guardrail as the primary LLM defense in the Q1 pipeline | accepted | 2026-07-21 |
| [0013](0013-deterministic-stochastic-split.md) | Deterministic L0â€“L4 / stochastic L5 only (constrained-reasoning pattern) | accepted | 2026-07-21 |
| [0014](0014-candidate-set-hard-filter.md) | Q1 picks hard-filtered to the L5 candidate set (LLM cannot pick outside data) | accepted | 2026-07-21 |
| [0015](0015-lens-mode-asset-class.md) | Lens mode: triggerable asset-class filter on the L5 reasoning agent | accepted | 2026-07-21 |
| [0016](0016-signed-weights-portfolio-accounting.md) | Signed-weights portfolio accounting convention (`direction` derived from sign) | accepted | 2026-07-22 |
| [0017](0017-since-inception-cumulative-performance.md) | Since-inception cumulative performance is compounded daily (`portfolio_cumulative_return`) | accepted | 2026-07-22 |
| [0018](0018-provenance-read-model-seam.md) | Provenance read-model seam between Python derivations and TypeScript status components | accepted | 2026-07-22 |
| [0019](0019-citation-value-reconciliation.md) | Citation guardrail reconciles cited values, not just source keys | accepted | 2026-07-23 |
| [0020](0020-theme-news-store-for-l5.md) | theme_news store feeds the L5 agent real news | accepted | 2026-07-23 |
| [0021](0021-signal-robustness-momentum-crowding.md) | Signal robustness: robust momentum + signed crowding | accepted | 2026-07-23 |
| [0022](0022-hypescore-ic-backtest.md) | HypeScore validation via Information-Coefficient backtest | accepted | 2026-07-23 |
| [0023](0023-data-provenance-and-fabrication-guard.md) | Data provenance labels + fabricated-data (R0) guard | accepted | 2026-07-23 |
| [0024](0024-persist-book-analytics-not-prompt-strings.md) | Persist book analytics as structured records, not prompt strings | accepted | 2026-07-23 |
| [0025](0025-book-centric-information-architecture.md) | Book-centric information architecture (`/book`, `/risk`, `/method`) | accepted | 2026-07-23 |
| [0026](0026-gemini-third-l5-provider.md) | Google Gemini as a third L5 LLM provider | accepted | 2026-07-23 |
| [0027](0027-citation-value-grounding.md) | Citation guardrail grounds on value, not source-label exactness | accepted | 2026-07-23 |
| [0028](0028-minmax-correlation-consistency.md) | Min-max \|corr\| across themes (supersedes T22 raw-abs) | **superseded by [0042](0042-absolute-hype-subscores.md)** | 2026-07-23 |
| [0029](0029-two-sided-book-decouple-direction-revive-momentum.md) | Two-sided book: decouple direction from the hype gate + revive momentum | accepted | 2026-07-23 |
| [0030](0030-unify-l5-candidate-pool-with-l1.md) | Unify the L5 candidate pool with L1 (screen_candidates consumes rank_trade_candidates) | accepted | 2026-07-23 |
| [0031](0031-edge-score-direction-signal.md) | EdgeScore: anchor long/short direction to trend + regime, not sentiment | accepted | 2026-07-23 |
| [0032](0032-edge-carry-value-abstention-sizing.md) | EdgeScore Stages 3â€“4: Carry, Value, abstention, conviction sizing | accepted | 2026-07-23 |
| [0033](0033-edge-stage5-sentiment-ic-weights.md) | EdgeScore Stage 5: sentiment demotion + IC-fit weights | accepted (IC claim **corrected by [0044](0044-carry-ic-was-measured-on-a-superseded-signal.md)**) | 2026-07-24 |
| [0034](0034-scoring-config-anon-read-policy.md) | Public read policy on scoring_config (frontend sees live weights) | accepted | 2026-07-24 |
| [0035](0035-volume-subscore-7day-average.md) | HypeScore Volume = 7-day average mentions, not the 1-day count | accepted | 2026-07-24 |
| [0036](0036-carry-as-excess-yield-over-funding.md) | Carry = excess yield over funding (two-sided); a missing component renormalises rather than scoring 0 | accepted | 2026-07-24 |
| [0037](0037-position-limits-bind-and-the-rest-is-cash.md) | Position limits actually bind; what they refuse is held in cash, not renormalised away | accepted | 2026-07-24 |
| [0038](0038-per-asset-direction.md) | Direction is a property of the asset, not its theme (the reason the book had no shorts) | accepted | 2026-07-24 |
| [0039](0039-scope-by-attention-abstain-by-asset.md) | Scope is chosen by attention; abstention is decided per asset (completes ADR-0038) | accepted | 2026-07-24 |
| [0040](0040-published-book-is-the-book-of-record.md) | The published book is the book of record (positions/returns/risk recomputed on L5 output) | accepted | 2026-07-24 |
| [0041](0041-regime-as-a-dial-not-a-cliff.md) | The regime is a dial, not a cliff â€” continuous risk appetite drives direction, the label is display only | accepted | 2026-07-24 |
| [0042](0042-absolute-hype-subscores.md) | HypeScore sub-scores are absolute, not relative to the day's peer group (supersedes 0006, 0028) | accepted | 2026-07-24 |
| [0043](0043-single-company-universe.md) | Single companies enter the universe (only meaningful once direction became per-asset) | accepted | 2026-07-24 |
| [0044](0044-carry-ic-was-measured-on-a-superseded-signal.md) | The carry IC justifying its 0.34 weight was measured on a superseded signal â€” corrects 0033 | accepted | 2026-07-24 |
| [0045](0045-turnover-on-names-without-a-verdict.md) | Turnover is measured on names without a verdict; candidate overlap is signed by both directions before thresholding | accepted | 2026-07-24 |
| [0046](0046-attention-chooses-what-we-look-at-not-what-is-tradable.md) | Attention chooses what we look at; a sub-attention theme holding a decisive name is admitted anyway | accepted | 2026-07-24 |
| [0047](0047-conviction-needs-a-vol-floor.md) | Conviction needs a vol floor, absolute rather than a percentile | accepted (**scope corrected by [0053](0053-the-published-book-was-sized-by-hype.md)**) | 2026-07-25 |
| [0048](0048-count-independent-ideas-not-candidates.md) | Count independent ideas, not candidates â€” the pool holds 13 long and 5 short, so five-and-five is no longer a universe problem | accepted | 2026-07-25 |
| [0049](0049-the-guardrail-does-not-read-the-prose.md) | The citation guardrail never inspects the thesis prose, and grounding cannot verify a count â€” every integer 0-9 grounds | accepted | 2026-07-25 |
| [0050](0050-separate-agent-churn-from-market-churn.md) | Measure agent churn separately from market churn â€” replicate reason_picks on frozen inputs | accepted | 2026-07-25 |
| [0051](0051-llm-timeout-bounded-silence-not-the-call.md) | LLM_TIMEOUT_SECONDS bounded the gap between bytes, not the call | accepted (**cause corrected by [0052](0052-a-stall-cost-three-attempts-not-one.md)**) | 2026-07-25 |
| [0052](0052-a-stall-cost-three-attempts-not-one.md) | A stall cost three attempts, not one â€” reason_picks retried timeouts; corrects 0051 | accepted | 2026-07-25 |
| [0054](0054-a-daily-publication-not-a-scanner.md) | The interface is a daily research publication, not a scanner â€” no streaming, no alerts, no filters; but the scannable layer must differentiate | accepted | 2026-07-25 |
| [0055](0055-an-acceptance-battery-for-the-model-that-writes-the-book.md) | An acceptance battery for the model that writes the book â€” frozen fixtures with a written-down right answer; structural checks gate, directional ones report | accepted | 2026-07-25 |
| [0056](0056-an-instruction-is-not-a-guardrail.md) | An instruction is not a guardrail â€” measure whether the thesis explains the independent ideas it declined, and let the panel say which case it is | accepted | 2026-07-25 |
| [0057](0057-stability-is-a-per-trade-fact-not-a-percentage.md) | Stability is a per-trade fact, not a book-level percentage â€” mark which positions survived every rerun | accepted | 2026-07-25 |
| [0058](0058-explanations-are-owed-per-empty-slot.md) | Explanations are owed per EMPTY SLOT, not per declined idea â€” corrects 0056; the frozen-input harness also confirmed the prompt works (ARKK named 3/3) | accepted | 2026-07-25 |
| [0059](0059-a-single-date-ic-is-not-validation.md) | A single-date IC is measured, not validated â€” the IC harness crashed before persist, and the panel would have flipped green on one day | accepted | 2026-07-25 |
| [0060](0060-a-share-cannot-exceed-the-whole.md) | A share cannot exceed the whole â€” net share is withheld on a market-neutral book instead of rendering Â±1000% | accepted | 2026-07-25 |
| [0061](0061-a-false-excuse-is-worse-than-none.md) | A false excuse is worse than none â€” reject an availability claim about a name that was in the pool; ADR-0049's rule extended from numbers to facts | accepted | 2026-07-25 |
| [0062](0062-run-date-is-not-a-write-timestamp.md) | A run's date is its run_date, not a write timestamp â€” the landing page dated the 07-25 run 07-24 by reading themes.updated_at | accepted (**description corrected by [0070](0070-forward-dating-was-never-implemented.md)**) | 2026-07-25 |
| [0063](0063-one-beta-bar-across-every-surface.md) | One sample bar for beta across every surface â€” and the recorded beta-direction guardrail is NOT built, because the claim is ambiguous rather than false | accepted | 2026-07-25 |
| [0064](0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md) | The audit page blamed the pipeline for its own arithmetic â€” /method recomputed EdgeScore without ADR-0036's renormalisation and published a RECONCILIATION FAILURE against a correct pipeline | accepted | 2026-07-25 |
| [0065](0065-check-the-published-book-not-only-the-generation.md) | Check the published book, not only the generation that produced it â€” the thesis guardrails now re-run daily against the persisted book_view | accepted | 2026-07-25 |
| [0066](0066-not-computable-must-persist-as-null.md) | "Not computable" must persist as NULL, not 0.0 â€” eight of nine positions had a renormalised score beside components written as zero | accepted | 2026-07-25 |
| [0067](0067-a-column-must-name-the-subset-it-measures.md) | A column must name the subset it measures â€” "Avg |rho| to book" averaged only pairs flagged at 0.70, so an empty column read as uncorrelated | accepted | 2026-07-25 |
| [0068](0068-a-cap-breach-is-not-decided-by-float-error.md) | A cap breach is not decided by floating-point error â€” a book clamped exactly to its 35% cap reported "US (35.0% > 35%)" | accepted | 2026-07-25 |
| [0069](0069-run-date-is-utc-not-the-local-clock.md) | `run_date` is UTC, not the local clock â€” a UTC+8 local run stamped a day ahead of the scheduled job, splitting positions from the published book | accepted | 2026-07-25 |
| [0070](0070-forward-dating-was-never-implemented.md) | Forward-dating was never implemented â€” the convention in 0062 was inferred from an artifact of a UTC+8 local run; corrects 0062's description | accepted | 2026-07-25 |
| [0071](0071-pool-metrics-are-not-book-metrics.md) | Pool metrics are not book metrics â€” the prompt labelled equal-weighted pre-selection pool figures "BOOK METRICS", and the thesis published a 31.67pp cap breach the book does not have | accepted | 2026-07-25 |
| [0072](0072-persist-the-books-correlation-structure.md) | Persist the book's correlation structure, not just its flagged tail â€” an empty flagged list left every surface saying only "nothing crossed 0.70" | accepted | 2026-07-25 |
| [0073](0073-a-factor-tilt-is-a-number-the-model-may-not-retype.md) | A factor tilt is a number the model may not re-type â€” the thesis called a book at Mkt âˆ’0.50 "market-neutral (Mkt -0.02)", restating the pre-selection pool | accepted | 2026-07-25 |
| [0074](0074-stress-both-tails-not-just-the-crash.md) | Stress both tails, not just the crash â€” all four scenarios were risk-off, so a net-short book's worst case read âˆ’0.0%; added a risk-on melt-up | accepted | 2026-07-25 |
| [0075](0075-per-pick-betas-are-joined-not-authored.md) | Per-pick betas are joined, and a regime shape is computed, not authored â€” all ten positions carried the same copied tilts, and a +34bps curve printed as "0.34 bps" became "an inverted curve" | accepted | 2026-07-25 |
| [0076](0076-a-guard-reports-every-failure.md) | A guard reports every failure, not the first one â€” three defects sat in one thesis and surfaced one per run because main() returned at the first | accepted | 2026-07-25 |
| [0077](0077-withhold-the-number-instead-of-forbidding-it.md) | Withhold the number instead of forbidding its use â€” the prompt block relabelled by ADR-0071 prepended its own `=== BOOK METRICS ===` header two lines below it | accepted | 2026-07-25 |
| [0078](0078-a-disqualifier-you-cannot-locate.md) | A disqualifier you cannot locate is not falsifiable â€” six of ten counter-theses named the 200-day MA as the trigger and nothing said what it was | accepted | 2026-07-25 |
| [0079](0079-adr-0078-described-a-book-that-had-been-replaced.md) | ADR-0078 described a book that had already been replaced â€” the evidence was read before a re-run launched in the same iteration, and written down after | accepted | 2026-07-25 |
| [0080](0080-a-gate-that-collects-nothing-is-not-a-gate.md) | A gate that collects nothing is not a gate â€” `pytest scripts/ \|\| true` collected zero of 44 test files and reported green; pytest becomes a gate, ruff/mypy stay reports at 217 errors | accepted | 2026-07-25 |
| [0081](0081-step-numbered-lineage-panel-on-book.md) | Worked-example lineage panel on /book (additive only): numbered StepNumbered primitive + a <details>-collapsed panel that surfaces one position's ingestion → theme → sizing → risk trail, with —  Source not yet persisted instead of fabricated citations | accepted | 2026-07-25 |
| [0082](0082-euler-risk-decomposition-on-the-final-book.md) | The book's risk decomposes by name, and a hedge is allowed to be negative — Euler decomposition on the final book, where a negative contribution is a hedge rather than a slice to clamp | accepted (backend live; render pending) | 2026-07-25 |
| [0083](0083-a-lineage-step-must-be-able-to-carry-its-own-proof.md) | A lineage step must be able to carry its own proof — one `reconcile()` verdict shared by /method and /book, three-state so "not yet scored" is never reported as a reconciliation failure, tolerances named per scale; corrects ADR-0081's Kelly-criterion sizing formula, which came from the external mockup and is not the model | accepted | 2026-07-25 |
| [0084](0084-method-splits-by-reader-question-not-by-copy.md) | /method splits by reader question, not by copy — 14.5 screens became `/method` (how a number is built) + `/method/evidence` (did it run, who checked it), sharing one `MethodBody` and one fetch so two chapters cannot disagree about a vintage; anchors hop client-side because a URL fragment never reaches the server; argues down the "four pages" non-goal and amends `design-goals.md` in the same change | accepted | 2026-07-26 |
| [0085](0085-direction-cannot-be-carried-by-hue-alone.md) | Direction cannot be carried by hue alone — goal 3's desaturation test has never passed and cannot at AA (`--long` vs `--short` is 1.29:1 desaturated, `--long` vs `--accent` 1.03:1, and any two inks clearing 4.5:1 on white are at most ~3.3:1 apart); direction becomes glyph + wordmark with hue as reinforcement, `--brand` is deleted as a duplicate of `--short`, and enforcement is scoped to the enumerated chip vocabularies with a widening clause | accepted | 2026-07-26 |
| [0086](0086-a-labelled-rail-that-collapses-rather-than-a-glyph-rail.md) | A labelled rail that collapses, rather than a glyph rail — collapsed 56px is the widest rail that preserves the two-pane layout (two panes need 1,304px, 91% of a 1,425px viewport), expanded 200px is the reader's explicit trade; amends the sidebar non-goal, which only ever objected to UNLABELLED glyph rails | accepted | 2026-07-26 |
| [0087](0087-a-chat-that-cannot-do-arithmetic.md) | A chat that cannot do arithmetic — `/ask` plans, fetches with the pages' OWN deterministic functions, then writes prose whose every numeral is adjudicated cited / quoted / unverified. Two LLM calls per question, no tool loop, no streaming (a guardrail cannot check a token already on screen). Adds the repo's first route handler and a spend guard that fails closed; amends design goal 5 and the four-destinations non-goal | accepted | 2026-07-26 |
| [0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md) | A stress scenario that does not transmit through market beta — S1-S5 are all a market shock scaled by a factor beta, so a position the factor model cannot see is invisible to the whole battery: on the live 2026-07-25 book NOC (`beta_mkt` −0.014, a 4.7% short whose thesis is geopolitical) had a 9bp worst case across all five, and 23.6% of gross was effectively unstressed. `S6_supply_shock` transmits through `SECTOR_MAP` instead and is inflationary, so duration stops hedging; it scores +1.48% and does **not** become the worst case, but it surfaces the book's short-gold-plus-short-defense position for the first time | accepted | 2026-07-26 |
| [0089](0089-a-citation-the-reader-can-follow.md) | A citation the reader can follow — the theme drawer rendered the headlines behind a HypeScore as plain, unclickable text, which is goal 1's failure shape exactly: it looks like provenance and terminates in a dead end. The link was never missing from the pipeline, it was discarded — both fetchers return one and `build_theme_signals` rebuilt each item without it. Migration 042 adds `theme_news.url`; the same pass starts writing `sentiment`, declared since migration 018 and never written. No backfill (the responses were never stored, and reconstructing a URL would manufacture the provenance the column exists to fix), so pre-042 rows render as plain text with a stated cause and mock rows persist NULL rather than a placeholder | accepted | 2026-07-26 |
| [0090](0090-a-published-pick-must-be-falsifiable.md) | A published pick must be falsifiable — every validation surface in the repo looks BACKWARD at signals (IC backtests, replication, eval battery); nothing scored the books actually published. The blocker was that a pick carried no testable claim: `time_horizon` is LLM-authored free text with two fuzzy values, and it moved for the same position (NOC short was "2-4 weeks" on 07-24 and "1-3 months" on 07-25) — a model choosing its own horizon grades its own exam. `pick_outcomes` (m043) + a pipeline-assigned 21-trading-day spec, matched to `backtest_edge`'s forward 1-month window so /method and the scorecard cannot disagree about what "works". Rows are written PENDING at publication so the denominator is fixed before any outcome is known; `void` requires a reason and `hit` requires its arithmetic, both by CHECK constraint. No Brier score — conviction is a sizing input, not a calibrated probability. Fixed while all 23 claims across 4 books were still unresolvable (first maturity ~2026-08-20) | accepted | 2026-07-26 |

## When to write an ADR

- Any architectural choice you'd struggle to explain six months from now
- Any deviation from the active plan or spec
- Locking in a tooling choice with meaningful alternatives

## How to write one

1. Copy this index entry format and create a new `NNNN-short-kebab-case-title.md` file
2. Fill in every section of the im-Jarvis template (Context, Decision, Consequences, Alternatives considered)
3. Status starts `proposed`; flip to `accepted` after sign-off
4. Add entry to this index

## Q1 reasoning pipeline ADRs (group)

ADRs 0012â€“0014 form a coherent design group for the L5 Q1 reasoning agent. They should be read together:

- **[0012](0012-citation-guardrail-llm-defense.md)** â€” the *what*: every numeric claim in the LLM output must cite a key in the L0â€“L4 input snapshot; un-cited or unresolved claims â†’ retry â†’ fallback.
- **[0013](0013-deterministic-stochastic-split.md)** â€” the *where*: the LLM is invoked only at L5. Layers L0â€“L4 are pure functions; the LLM is a constrained synthesizer, not an agent.
- **[0014](0014-candidate-set-hard-filter.md)** â€” the *which*: the LLM can only pick names that survived `screen_candidates`. It cannot invent tickers or break theme-asset coherence.

Together: the L5 agent is auditable (L0â€“L4 are pure), constrained (candidate filter), and self-checking (citation guardrail). See [ARCHITECTURE.md](../../ARCHITECTURE.md) for the data flow and [spec Â§14](../superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md) for the full design.

### Naming note â€” L5 storage tables (read before grepping the ADRs)

ADRs **0011, 0012, 0013 and 0015** were written before migration **008** and name the L5 storage tables by their **original** names. Those tables were renamed in place and are the authoritative names everywhere in the live schema and code today:

| As written in the ADRs (pre-008) | Current table (post-008, live) |
|---|---|
| `q1_agent_runs` | `research_agent_runs` |
| `q1_recommendations` | `research_recommendations` |

The rename (migration `008_rename_q1_tables.sql`, [PROGRESS 2026-07-21](../../PROGRESS.md)) was label-only â€” it changed no schema, guardrail, or decision, so the ADR bodies are left intact as the historical record. When a doc, query, or grep needs the live name, use the right-hand column. Only the **tables** were renamed; the L5 module and its entry point kept their names â€” `backend/services/q1_agent.py::run_q1_agent`.
