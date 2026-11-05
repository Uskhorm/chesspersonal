# Hindsight v3: contracts for the "interactive + pro" round

User feedback driving this round:
- "The board isn't even interactive." "It's a slideshow." The user wants to **play moves on the board** anywhere, and to see lines **play out visually** (animated), not SAN chips.
- "Stop telling me Qhex whatever, make it simple." Prose must use **plain English moves** ("your queen takes the pawn on e6, check"). SAN stays only as a small secondary label.
- "Auto-analyse my last 10 games without me asking."
- "No dark mode." "Design and animations are amateur." It has to be snappy, fast and fluid, at a professional level.
- "Make the insight engine and the reasoning engine way better."

## Ground rules (every agent)
- Shared checkout. **Only edit the files you own.** The lead and other agents edit everything else at the same time.
- **Do not edit `package.json` or the lockfile.** These are preinstalled: react 19, chess.js, dexie, zustand, @simplewebauthn/browser, ts-fsrs, animejs v4, motion (motion/react), canvas-confetti, lucide-react, @tanstack/react-virtual, @lichess-org/chessground, vitest, fake-indexeddb.
- No `git commit` or `git push`.
- Typecheck with `npx tsc --noEmit`, ignoring errors in other owners' files. Tests go in `src/lib/__tests__/<module>.test.ts`; run yours with `npx vitest run <file>`.
- Write files as **UTF-8** (no cp1252 characters).
- Keep existing exported signatures backward compatible. Add, don't break.
- Final report: files, exact exported API, test results, caveats.

## UI ownership
The **design agent** (Opus) owns `src/styles.css`, `src/components/**`, `src/pages/**`, `src/App.tsx`, `src/main.tsx` and `index.html`. Codex agents provide hooks and pure functions only.

## Modules (one owner each)

### X1 `src/lib/sync.ts`: auto-analysis
- On the first sync after load or sign-in, automatically queue the **10 most recent unanalysed games**, newest first. After that, every new game is queued as soon as it's seen. The user never has to ask.
- Keep `enqueueAnalysis`, `useQueue`, `startAutoSync`, `syncGames`, `getOrAnalyse` and `markReviewed` stable.
- Add `analyseRecent(n = 10)`.
- Add `useQueue` fields `{ batchTotal, batchDone }` for "Reviewing 3 of 10".
- Pause the queue while the tab is hidden for more than 5 min, then resume.
- Pause the queue while a training session is active, and resume after: export `pauseAnalysis(boolean)`.

### X2 `src/lib/live.ts` (new) + `src/lib/explorer.ts` (new): the interactive analysis board
- `live.ts`: a **dedicated** Stockfish worker, separate from the batch pool in `engine.ts` (read `engine.ts` but don't edit it).
  - `startLive(fen, { multipv = 3, onUpdate(lines: LiveLine[], depth) }) => stop()`.
  - It streams `info` lines and debounces UI updates to 100 ms. A new `startLive` stops the previous search.
  - `LiveLine = { uci, san, plain, score: Score, win: number /* side-to-move POV 0-100 */, pv: string[] }`.
  - `plain` comes from `narrate.ts` (X3); import `describeMove`.
- `explorer.ts`: `useExplorer(startFen: string, opts?: { perspective: Color })` gives a move tree from a game position. It returns:
  - `{ fen, lastMove, turn, node, path, canBack, canForward, lines /* live top-3 */, depth, threat /* opponent's best reply if it were their move, plain text */, arrows /* top line green, 2nd/3rd faint */, legalDests: Map }`;
  - `actions: { play(from, to, promo?), back(), forward(), goto(nodeId), reset(fen?), playLine(ucis[]) }`.
- Must work with engine-less fallback in tests (mock the worker).

### X3 `src/lib/narrate.ts` (new): plain-English moves
- `describeMove(fenBefore, move /* SAN or UCI */, opts?: { perspective?: Color; style?: 'short' | 'full' })`. Examples:
  - full style: "Your queen takes the pawn on e6, check", "Their knight jumps to f3", "You castle kingside", "Your pawn promotes to a queen on e8, checkmate".
  - short style: "Queen takes e6+".
- `describeLine(fen, moves[], opts)` returns `string[]`.
- `pieceName(type)`, `squareName(sq)`.
- Must be grammatical and never output SAN except in short style.

### X4 `src/lib/coach.ts`: reasoning engine v3
- All prose uses `narrate.ts`. No SAN in sentences; SAN may appear in a separate `san` field.
- Add `positionFeatures(fen, color)` covering:
  - king safety: pawn shield, open or half-open files near the king, attackers near the king;
  - hanging and undefended pieces, plus loose pieces attacked;
  - mobility;
  - pawn structure: isolated, doubled, passed;
  - development in the opening.
- `explainMove` uses the before/after feature deltas to explain quiet and positional mistakes too, e.g. "This opens the f-file toward your king" or "This leaves your bishop on c4 undefended".
- Add `threatsAfter(m)`: what the opponent now threatens, in plain English.
- Keep `hints`, `bestMovePlan`, `explainMove` (with `rule`) and `replaySan` signatures; update their text to plain English.
- Add `Explanation.points?: { kind: 'good' | 'bad'; text: string; squares?: string[] }[]` so the UI can highlight squares per point.

### X5 `src/lib/insights.ts`: insight engine v3
- Keep the existing exports. Add:
  - which piece type you blunder most;
  - tactic-motif breakdown over time (this month vs last);
  - performance vs opponent rating bands (lower, similar, higher);
  - tilt detection (results and accuracy in the game after a loss vs after a win);
  - time-of-day and day-of-week performance;
  - performance by time control;
  - accuracy after move 30 vs before;
  - "best and worst game this week".
- `insightCards(games, analyses, drills, now)` returns 4–8 ranked cards `{ id, title, body /* plain English, specific numbers */, metric?: { value: string; label: string; trend?: 'up' | 'down' | 'flat' }, cta?: { label: string; href: string }, severity: 'win' | 'warn' | 'info' }`.

### X6 `src/lib/playback.ts` (new): fluid auto-play
- `usePlayback(steps: { fen: string; lastMove?: [string, string]; label?: string }[], opts?: { interval?: number /* default 900 */; autoplay?: boolean; loop?: boolean })` returns:
  - `{ index, step, playing, progress /* 0-1 for a scrubber */ }`;
  - `play()`, `pause()`, `toggle()`, `next()`, `prev()`, `seek(i)`, `speed`, `setSpeed(0.5 | 1 | 2)`.
- Uses rAF-friendly timers and pauses when the tab is hidden.
- `buildSteps(fen, moves[])` returns steps, using `narrate` labels.

### X7 `src/lib/theme.ts` (new) + `src/lib/sound.ts`
- `useTheme()` returns `{ theme: 'light' | 'dark' | 'system', resolved: 'light' | 'dark', setTheme }`.
  - It sets `document.documentElement.dataset.theme = resolved` and `color-scheme`, and persists to localStorage `hindsight-theme`. Default is `system`.
  - It follows `prefers-color-scheme` live, and updates `<meta name="theme-color">`.
  - Export `initTheme()` for pre-render (avoid a flash).
- `sound.ts`: rework into a professional, subtle sound set (wood move, capture thunk, check, castle, correct/wrong chimes). Keep the export names; volume 0.6 by default; respect a `reducedMotion`-like quiet mode.

### X8 `src/lib/db.ts` + `src/lib/queries.ts` (new): speed
- Dexie v3 adds `summaries` (`gameId`, plus `{ accuracy, counts, curve /* winCurve downsampled to ≤ 64 pts */, opening, eco, userColor }`).
  - It's written automatically by hooks on `analyses` creating/updating, with a migration that backfills from existing analyses.
  - Keep the sync outbox behaviour intact: summaries are NOT synced; they're derived on pull too, because hooks fire on server-applied writes.
- `queries.ts` hooks avoid loading 100 KB analyses for list views:
  - `useRecentGames(limit)`, `useGamesPage(filter, offset, limit)`, `useGameCount(filter)`;
  - `useSummaries(gameIds?)`, `useAnalysis(gameId)`, `useDrillStats()` (due, mastered, total, dueTomorrow), `useTodayActivity()`.

### X9 `src/lib/chesscom.ts`: full history
- `fetchAllGames(username, { onBatch(games), signal })` walks ALL monthly archives, newest first, rate-limited (≥ 300 ms between requests), resumable (stores progress in localStorage).
- `fetchRecentGames` stays.
- Add `fetchPlayerStats` normalisation: current, best and record per time class.

### X10 `src/lib/moveinput.ts` (new) + `src/lib/hotkeys.ts` (new)
- `parseMoveInput(fen, text)` returns `{ uci, san } | { error }`. It accepts SAN ("Nf3"), UCI ("g1f3"), and plain English ("knight f3", "knight to f3", "takes on e5", "castle short", "pawn e4").
- `useHotkeys(map: Record<string, (e) => void>, deps)` handles ←/→/space/h/f/Escape and number keys, ignoring typing in inputs.
