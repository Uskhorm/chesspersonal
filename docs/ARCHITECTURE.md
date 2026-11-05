# Hindsight — architecture & module contracts

Hindsight (formerly ChessPersonal) is a chess.com game-review + training app.
Frontend: React 19 + Vite + TS, static-hosted (GitHub Pages now; Vercel later).
Backend: Supabase (Postgres + one Edge Function `api`). Auth = chess.com username + **passkey** (WebAuthn). No OAuth, no passwords.
Everything the user does (XP, streaks, quests, drills/SRS state, analyses, activity) syncs across browsers.

Existing code to read first: `src/lib/types.ts` (core types), `src/lib/analysis.ts`, `src/lib/classify.ts`,
`src/lib/engine.ts`, `src/lib/db.ts` (Dexie), `src/lib/store.ts` (zustand progress), `src/lib/srs.ts`, `src/lib/learning.ts`, `src/lib/sync.ts` (chess.com polling + analysis queue).

## Ground rules for every agent
- Shared checkout. **Only edit files you own** (listed per module). Other agents edit other files concurrently.
- **Do not edit `package.json` / lockfile.** Preinstalled: react, chess.js, dexie, zustand, @simplewebauthn/browser, ts-fsrs, vitest, fake-indexeddb, animejs, motion, stockfish. If you truly need another dep, say so in your final report.
- **UI files are owned by the lead** (`src/components/**`, `src/pages/**`, `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `index.html`). Do not edit them; expose clean hooks/functions the UI can call.
- No `git commit` / `git push`. The lead integrates.
- Typecheck: `npx tsc --noEmit` — ignore errors in files you don't own (others are mid-edit).
- Tests: vitest, put them in `src/lib/__tests__/<module>.test.ts` (or next to backend code). Run only yours: `npx vitest run <path>`.
- Never put secrets in code. Config comes from env (`import.meta.env.VITE_API_URL` on the client; `Deno.env` in the function).
- Final report: files changed, public API (signatures), how to test, caveats.

---

## M1 — Backend (owner: backend agent) — `supabase/**`
- `supabase/config.toml`, `supabase/migrations/0001_init.sql`, `supabase/functions/api/index.ts` (+ helpers in that folder), `supabase/functions/api/deno.json` if needed.
- Tables (RLS **enabled**, **no policies** → only the service role, i.e. the function, can touch them):
  - `users(id uuid pk default gen_random_uuid(), username text unique not null /* lowercase chess.com username */, display_name text, avatar text, created_at timestamptz default now())`
  - `passkeys(id text pk /* credential id, base64url */, user_id uuid references users on delete cascade, public_key text /* base64url COSE */, counter bigint not null default 0, transports text[], device_name text, created_at timestamptz default now(), last_used_at timestamptz)`
  - `challenges(id uuid pk default gen_random_uuid(), challenge text not null, kind text not null /* 'register'|'login'|'add' */, user_id uuid, username text, expires_at timestamptz not null)`
  - `kv(user_id uuid references users on delete cascade, collection text, key text, data jsonb, updated_at timestamptz not null, deleted boolean not null default false, primary key (user_id, collection, key))` + index on `(user_id, updated_at)`.
- Edge Function `api` (Deno, `npm:@simplewebauthn/server@13`, `npm:@supabase/supabase-js@2`), deployed with `verify_jwt = false` (we do our own auth). Session = HS256 JWT signed with env `SESSION_SECRET`, `sub` = user id, 60-day expiry. Use `crypto.subtle` (no extra JWT lib needed).
- CORS: allow origins from env `ALLOWED_ORIGINS` (comma list, e.g. `https://uskhorm.github.io,http://localhost:5199,http://localhost:5173`). WebAuthn `rpID` = hostname of the request `Origin` (must be in the allow list); `expectedOrigin` = that origin. rpName "Hindsight".
- Routes (all JSON, path after `/api`, e.g. `${VITE_API_URL}/auth/login/options`):
  - `POST /auth/register/options {username}` → validate on chess.com (`https://api.chess.com/pub/player/{u}`; 404 → 400 `{error:'not_found'}`). If user exists **with passkeys** → 409 `{error:'exists'}`. Returns `{challengeId, options}` (residentKey `required`, userVerification `preferred`, user.name = username).
  - `POST /auth/register/verify {challengeId, response, deviceName?}` → creates user (display_name/avatar from chess.com profile) + passkey → `{token, user}`.
  - `POST /auth/login/options {}` → `{challengeId, options}` (discoverable: no allowCredentials).
  - `POST /auth/login/verify {challengeId, response}` → look up passkey by `response.id`, verify, bump counter/last_used → `{token, user}`.
  - `POST /auth/passkeys/options` (auth) / `POST /auth/passkeys/verify {challengeId, response, deviceName?}` (auth) → add another passkey for the same user.
  - `GET /auth/passkeys` (auth) → list `{id, device_name, created_at, last_used_at}`; `DELETE /auth/passkeys/:id` (auth, refuse deleting the last one).
  - `GET /me` (auth) → `{user}`.
  - `POST /sync/pull {since?: string /* ISO */}` (auth) → `{items: SyncItem[], now: string}` (items with `updated_at > since`, ordered, max 2000 per call + `more: boolean`).
  - `POST /sync/push {items: SyncItem[]}` (auth, ≤ 200 items, ≤ 4 MB) → last-write-wins on `updated_at` → `{ok:true, now}`.
  - `SyncItem = { collection: string; key: string; data: unknown; updated_at: string; deleted?: boolean }`
  - `user` JSON shape: `{ id, username, display_name, avatar }`.
  - Errors: `{error: string, message?: string}` with proper status codes.
- Challenges expire after 5 min and are deleted once used.

## M2 — Client API + auth (owner: auth agent) — `src/lib/api.ts`, `src/lib/auth.ts`
- `api.ts`: `export const API_URL = import.meta.env.VITE_API_URL as string | undefined;` `export const cloudEnabled = !!API_URL;` `export async function api<T>(path: string, body?: unknown, method?: string): Promise<T>` (adds `Authorization: Bearer <token>` when signed in; throws `ApiError {status, code, message}`).
- `auth.ts` (zustand store `useAuth`, persisted in localStorage key `hindsight-auth`):
  - state `{ token: string | null; user: CloudUser | null; status: 'signed-out' | 'signed-in' }`
  - `signUp(username: string): Promise<CloudUser>` (register options → `startRegistration` from `@simplewebauthn/browser` → verify)
  - `signIn(): Promise<CloudUser>` (discoverable passkey, `startAuthentication`; also try conditional UI helper `signInConditional(signal)` for autofill)
  - `addPasskey(deviceName?: string)`, `listPasskeys()`, `removePasskey(id)`, `signOut()`
  - `passkeySupported(): Promise<boolean>`
  - Friendly error mapping (user cancelled, not found on chess.com, already registered, no passkey on this device).
  - On sign-in/up it must call `useStore.getState().connect(user.username, user.avatar, user.display_name)` (existing store API) and then `cloudsync.start()` (M3; import lazily `await import('./cloudsync')`).

## M3 — Cloud sync (owner: sync agent) — `src/lib/cloudsync.ts`, `src/lib/db.ts`, `src/lib/store.ts`
- Dexie v2 adds an `outbox` table `{id: '<collection>:<key>', collection, key, updated_at}`. Hooks on `games`, `analyses`, `drills`, `activity` enqueue changes (creating/updating/deleting). Changes applied *from* the server must not re-enqueue (use a module flag / transaction tag).
- Collections: `games` (key = game id), `analyses` (key = gameId), `drills` (key = drill id), `activity` (key = day), `progress` (single key `state`: the zustand persisted state minus transient fields).
- `start()`: pull since last cursor (stored in localStorage `hindsight-sync-cursor`), apply, then push outbox (batches ≤ 100 items; analyses can be ~100 KB, so batch by size ≤ 3 MB). Afterwards: push debounced 2 s after changes; pull every 90 s and on window focus/visibility. `stop()`, `syncNow()`.
- Progress merge (don't lose XP made on two devices): `mergeProgress(local, remote)` = max of xp/trainingRating?/stats numbers, union of achievements/unlockedThemes, streak = the one with later `lastDay` (tie → higher count), chests = max, quests = same day → per-quest max progress, settings = newer. Expose `useStore.getState().hydrate(state)` in `store.ts` for applying merged state, and a subscription that marks progress dirty on change.
- Drills merge: newer `updated_at` wins (add `updatedAt?: number` to Drill writes if useful — coordinate via types only in your files; `types.ts` is owned by you too for sync-related fields).
- Zustand hook `useCloudSync()` → `{ status: 'off'|'idle'|'syncing'|'error'|'offline', lastSyncedAt, pending: number, error? }` for the UI.
- Signing out: `stop()`, keep local data (UI offers "clear device").

## M4 — Coach + Learn-mode flow (owner: coach agent) — `src/lib/coach.ts`, `src/lib/learnflow.ts`
- `coach.ts` (pure, uses chess.js; inputs are `AnalysedMove`s from `types.ts`):
  - `explainMove(m: AnalysedMove): Explanation` — `{ headline: string; detail: string; tags: string[] }` human, specific coaching: what the played move allows (from `replyLineSan`: material lost along the line, allowed mate, allowed fork, hanging piece), and what the best move achieves (from `bestLineSan`: wins material — which piece, mate in N, fork of X and Y, discovered attack, trapped piece, promotion, defends threat, improves eval from A to B). Never generic filler.
  - `bestMovePlan(m): { san: string; idea: string; line: string[]; lineExplained: { san: string; note?: string }[] }`
  - `hints(m): Hint[]` exactly 3 progressive levels: L1 = concept ("There's a tactic: look for a double attack" / "Your king is in danger — find the defensive resource"), L2 = which piece ("Your bishop on a6 is the hero") + `highlight.squares`, L3 = target square/arrow (`highlight.arrow: [from,to]`) without spelling out the SAN.
  - `Hint = { level: 1|2|3; text: string; highlight?: { squares?: string[]; arrow?: [string, string] } }`
- `learnflow.ts`: React hook `useLearnFlow(analysis: GameAnalysis, userColor: Color)` implementing the key-moment trainer as a reducer/state machine. Requirements from the user's complaints: they must be able to go **back and forth** (between moments and through the moves leading up to a moment), hints must be **useful**, and after failing they must be **shown what they could have done** and **why**, be able to **step through the best line**, and then **play the correct move themselves** before moving on (errorful learning + corrective feedback). Nothing auto-advances.
  - Phases: `'intro' | 'solve' | 'checking' | 'wrong' | 'solved' | 'explain' | 'replay' | 'confirm' | 'complete'`.
  - Returns `{ moments, index, phase, attempts, hintsUsed, hint?: Hint, explanation?, plan?, board: { fen, lastMove?, arrows: Arrow[], highlights: string[], orientation, movable: boolean }, replay: { step, total }, contextPly, results: ('first-try'|'with-help'|'failed')[], actions: { submitMove(from,to,promo?), nextHint(), giveUp(), replayStep(delta: 1|-1), replayTo(i), confirmMove(from,to), nextMoment(), prevMoment(), goToMoment(i), stepContext(delta) /* browse the game moves before the moment */, backToPuzzle() } }`.
  - `Arrow = { from: string; to: string; brush: 'best'|'played'|'alt'|'hint' }` (same as `src/components/Board.tsx`). Verification uses `verifyMove` from `src/lib/verify.ts` (engine-checked; alternative good moves count).
  - Side effects (XP, quests, SRS) go through a callback option `onResult?(moment, result)` so the UI/stores stay decoupled.

## M5 — Analysis calibration + speed (owner: analysis agent) — `src/lib/analysis.ts`, `classify.ts`, `winpct.ts`, `engine.ts`, `verify.ts`, `scripts/calibrate.mjs`
- Build a Node harness (uses `stockfish` npm package's lite-single engine via `require('stockfish')`) that analyses N recent games of public chess.com accounts across rating ranges (e.g. 800, 1500, 2200) which carry chess.com `accuracies`, and reports our accuracy vs chess.com's plus label frequencies (brilliant/great/miss/blunder per game).
- Tune thresholds so accuracy correlates closely and Brilliant/Great are rare (chess.com: brilliant ≈ <1 per several games, great ≈ 0–2 per game). Keep the expected-points model.
- Speed: one game currently takes ~20–25 s at depth 16 in-browser with 4 workers. Improve (e.g. reuse hash between consecutive positions, `go depth` + `movetime` cap, skip MultiPV 2 where unnecessary, smarter cloud usage). Keep the public API of `analysePgn` stable.

## M6 — FSRS + training flow (owner: training agent) — `src/lib/srs.ts`, `src/lib/learning.ts`, `src/lib/trainflow.ts`
- Replace SM-2 with FSRS via `ts-fsrs` (keep `schedule(d, grade)`, `gradeFrom`, `isMastered`, `dueLabel`, `newDrill` signatures; migrate old drills lazily: missing FSRS fields → treat as new card).
- `trainflow.ts`: hook `useTrainSession(mode: 'session'|'leak'|'rush')` with the same "fail → explain → replay → do it again" loop as M4 (reuse `coach.ts` hints/explanations from M4 — import them; they'll exist by integration), combo/lives/timer, adaptive 85% targeting, Lichess puzzles (`src/lib/lichess.ts` also yours; add `difficulty` param + simple in-memory cache/dedupe), results + callbacks `onCorrect/onWrong/onFinish` for the UI to hook XP/fx.

## M7 — Insights engine (owner: insights agent) — `src/lib/insights.ts`
- Pure functions over `StoredGame[]` + `GameAnalysis[]` + `Drill[]`: rating trend per time class; accuracy trend; win/draw/loss by colour & by opening (ECO/name); clock usage (from `%clk`: average time per move by phase, % of mistakes in time trouble); conversion rate (games where you reached ≥ +3 / win% ≥ 80 and won); comeback rate; blunder rate per 100 moves; best/worst openings; "biggest swing" moments; weekly summary object. Plus tests.

## M8 — Opening repertoire trainer (owner: repertoire agent) — `src/lib/repertoire.ts`
- Build the user's repertoire tree (as White and as Black) from their games: position → user's moves with counts, results, and engine evaluation of those moves from stored analyses. Detect "opening leaks" (the user's habitual move is an inaccuracy+ per engine, or a line with poor results), and produce opening drill cards compatible with `Drill` (tag `motifs: ['opening']`). Export `buildRepertoire(games, analyses)`, `openingLeaks(rep)`, `openingDrills(rep)`, `lineFor(rep, color, ply)`; tests.

## M9 — PWA / offline / perf (owner: pwa agent) — `public/manifest.webmanifest`, `public/sw.js`, `src/lib/pwa.ts`, `public/icons/**`
- Installable PWA (name "Hindsight"), service worker that caches the app shell + the Stockfish `engine/*.js|wasm` (cache-first, versioned) and the openings chunk; works under a sub-path (`import.meta.env.BASE_URL`). `src/lib/pwa.ts`: `registerSW()`, `useInstallPrompt()` (beforeinstallprompt), `useOnline()`. Icons: generate simple PNGs from `public/icon.svg` at 192/512 (use a small node script with no new deps, e.g. render via `@resvg/resvg-js` is NOT installed — instead hand-write SVG icons and reference SVG in the manifest plus maskable variant).
