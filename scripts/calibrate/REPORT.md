# M5 calibration and speed handoff

Measured 2026-11-05 in Node 24.13.1, Stockfish 19 lite-single, four isolated
workers, depth 16, 32 MB hash per worker, cloud disabled. Nine public reviewed
games, 18 player accuracies, 704 plies / 713 positions. Games were selected in
round-robin bands by the lower-rated participant: <1200, 1200–1999, >=2000.
Ratings span 397–3088; several games are amateur-versus-master mismatches.
The initial corpus comes from GothamChess and DanielNaroditsky archives and
includes olima_omega, dimarvelous, stateofzane, Lukmaneff, Ranjan2009 and
KamalovBekbolatKamalovich. These are recent *available* reviewed games per
account, not necessarily games played this week. Some are daily games.

| Metric | Original pipeline/model | Calibrated, same original evaluations | Calibrated + faster search |
| --- | ---: | ---: | ---: |
| Accuracy MAE, percentage points | 4.98 | 4.28 | 4.44 |
| Pearson correlation | 0.779 | 0.835 | 0.831 |
| Fit-set MAE (first 6 games) | 3.95 | 3.00 | 3.50 |
| Holdout MAE (last 3 games) | 7.04 | 6.82 | 6.31 |
| Mean seconds/game | 19.23 | — | 12.85 |
| Seconds normalized to 80 plies | 19.67 | — | 13.14 |

The faster path takes **33.2% less time (1.50x throughput)**. These are single-pass
Node measurements, excluding engine initialization and API fetching, including
evaluation and analysis assembly. Cached reruns preserve the measured timings;
use `--rerun` for fresh timing. Browser timing has not been measured here.

| Labels per game, both sides combined | Original | Calibrated, original evals | Calibrated + faster search |
| --- | ---: | ---: | ---: |
| Brilliant | 1.11 | 0.22 | 0.22 |
| Great | 2.00 | 1.78 | 1.78 |
| Miss | 0.89 | 0.67 | 0.56 |
| Blunder | 2.00 | 2.00 | 2.00 |
| Mistake | 3.00 | 3.22 | 3.44 |
| Inaccuracy | 5.89 | 5.89 | 6.00 |

Great ranges from 0–4 per game in this corpus; there is no artificial per-game
quota. The public API exposes accuracies but **does not expose chess.com's move
labels**. The frequency targets are plausibility constraints, not measured
agreement with chess.com's annotations. Nine games are exploratory calibration,
not evidence of universal CAPS parity. The three-game holdout is very small.

## Final model and thresholds

- Keep the logistic expected-points model (cp coefficient 0.00368208).
- Move accuracy uses the existing bounded exponential family, with decay 0.045
  instead of 0.04354415386753951. Grid fitting used the first six games only.
- Game accuracy is the harmonic mean of that side's move accuracies, floored
  at 1 for reciprocal calculation, rounded to one decimal. The fit preferred
  this to the previous equal volatility/harmonic blend. This deliberately makes
  serious errors count more than many automatic moves in a decided position.
- EP-loss thresholds stay <0.02 Excellent, <0.05 Good, <0.10 Inaccuracy,
  <0.20 Mistake, otherwise Blunder. Forced and book take precedence.
- Brilliant requires an exact best new offer of the moved non-pawn piece,
  >=2 pawns net sacrifice, >=55% maintained chances, <90% before the move,
  no routine recapture, and no prior attack on its origin square. This is a
  conservative heuristic; it can miss valid brilliancies.
- Great requires a >=20 percentage-point second-line gap, changed outcome
  (68/32 outcome boundaries), <95% before the move, >2 legal moves, no routine
  recapture. A sound Brilliant takes precedence.
- Miss requires a missed mate, or an opponent's >=0.10 EP gift followed by
  >=0.10 EP loss, >=70% before and <65% after. The existing >=30% after floor
  remains, so catastrophic failures are still reported as blunders.

## Speed and quality checks

No depth reduction, time cap, synthetic PV evaluation or unsearched-position
skipping. Retain the hash between positions. Schedule dynamic runs of four
consecutive positions per worker to avoid static-chunk imbalance. Search one
PV first and refine to MultiPV 2 at full depth only where a played best move
could receive Great. Book moves, recaptures, decisive wins and near-forced
positions do not need that second line. Cloud lookup has a total 1.2-second
budget and only accepts evaluations at least as deep as the requested depth.
Batch cancellation prevents new work being queued after cancellation.

Across the 713 positions, the faster search differs by **0.94 expected-points
percentage points on average** (95th percentile 2.76). Best UCI agreement is
74.5%; complete move-class agreement is 74.9%, including sensitivity near
classification thresholds and changes among near-equal engine choices. The
calibrated full-MultiPV MAE is 4.28 versus 4.44 for the faster path: a 0.16-point
difference on this sample. Full requested depth is retained, but identical
principal variations or labels are not guaranteed.

## Public API

Existing named exports and call signatures remain compatible, including
`analysePgn` and `engine.analyse`.

Added in `analysis.ts`:

```ts
type PositionEvaluator = (fen: string, index: number) => Promise<PositionEval>;
analyseWithEvaluator(gameId, pgn, opts, evaluator, batch?: false): Promise<GameAnalysis>;
analyseWithEvaluator(gameId, pgn, opts, batchEvaluator, batch: true): Promise<GameAnalysis>;
// batchEvaluator: (fens: string[]) => Promise<PositionEval[]>
secondLineCandidates(history: Move[], evals: PositionEval[]): number[];
```

Added `engine.analyseBatch(fens, depth, multipv = 2, onResult?)` returning ordered
`PositionEval[]`. `gameAccuracy` accepts an optional fourth `firstColor` for
black-to-move starting FENs. `cloudEval` accepts an optional third timeout in ms.
`verifyMove` now compares promotion pieces as part of exact UCI matching.

## Reproduce and validate

```sh
node scripts/calibrate.mjs --games=9 --depth=16 --workers=4 --sweep
node scripts/calibrate.mjs --games=9 --depth=16 --workers=4 --rerun
node scripts/calibrate/fit.mjs
node scripts/calibrate.mjs --games=12 --refresh
node scripts/calibrate.mjs --games=3 --refresh --discover-only --corpus=scripts/calibrate/results/discovery-smoke.json
npx vitest run src/lib/__tests__/classify.test.ts src/lib/__tests__/winpct.test.ts
npx tsc --noEmit
```

The harness loads the actual TS pipeline using Vite's SSR transformer with HMR
disabled; it does not start a listening server. Each Node worker calls
`require('stockfish')('lite-single', onLine)` per the installed README. This
also isolates the package's module state. Discovery calls chess.com archives
and month endpoints with `User-Agent: Hindsight/1.0`, starts from a live
leaderboard plus teaching accounts, and visits real amateur opponents. A fresh
discovery smoke run visited leaderboard account MagnusCarlsen and discovered
opponent sgm-2010 successfully, skipping an API-listed month that returned 404.

Raw corpus, per-position evaluations, per-game frequencies, correlation, MAE,
holdout results and timing are in ignored `results/` JSON artifacts. The
original move-accuracy, aggregation and badge rules are frozen in the harness
for before/after comparisons. `fit.mjs` prints candidate parameters and never
modifies production constants.

Validation: **30 focused tests pass; `npx tsc --noEmit` passes** as of the final
check. No package/dependency files, UI files or other owners' modules were edited.
No commit was made.

Changed files: `src/lib/{analysis,classify,winpct,engine,verify}.ts`,
`src/lib/__tests__/{classify,winpct}.test.ts`, `scripts/calibrate.mjs`,
`scripts/calibrate/{stockfish-worker.mjs,fit.mjs,.gitignore,REPORT.md}`.
