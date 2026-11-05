<img src="public/icon.svg" width="64" height="64" alt="">

# Hindsight

**See what you missed.** Open-source chess game review that turns every mistake you make into training.

**▶ Live: https://uskhorm.github.io/hindsight/**

Sign in with your chess.com username and a passkey. No password, no OAuth. Every game you finish is pulled in and reviewed by Stockfish 19 in your browser. Each mistake, miss and blunder becomes a position you re-solve on a spaced-repetition schedule until you stop making it. Your progress syncs to every browser you sign in on.

## What it does

**Game review**
- Stockfish 19 (WASM) runs in parallel Web Workers, with Lichess cloud eval for opening positions.
- Moves are classified as Brilliant · Great · Best · Excellent · Good · Book · Inaccuracy · Mistake · Miss · Blunder. The thresholds are calibrated against chess.com accuracies; the harness is in `scripts/calibrate`.
- The "game tape" timeline lets you scrub through the eval curve. Each move gets a verdict stamp, plus coaching that puts the answer first and gives a one-line rule you can reuse.

**Learning loop**
- **Learn mode**: find the better move yourself first. Hints go from piece, to idea, to arrow. Then the answer and its rule, a step-through of the line, and you play it yourself. You can browse, skip and move between moments at any time.
- **FSRS spaced repetition** (`ts-fsrs`) of your own mistakes. Grading accounts for hints, and sessions interleave motifs and adapt toward roughly 85% success.
- **Transfer practice**: after each drill you get a Lichess puzzle with the same motif, but a new position.
- **Elo leak report** and opening-repertoire leaks, with training aimed at your biggest weakness.
- **Rewards**: XP, streaks with freezes, daily quests, achievements and milestone chests. They're built so they follow what you actually recall, not clicking through.

## Architecture
- **Frontend**: React 19, Vite, TypeScript, chessground, chess.js, Dexie, Zustand, anime.js, Motion. Installable PWA with offline engine cache.
- **Backend**: Supabase. Postgres with RLS-locked tables, plus one Edge Function (`supabase/functions/api`) for WebAuthn passkey auth (`@simplewebauthn`) and last-write-wins sync.
- See `docs/ARCHITECTURE.md` for the module contracts.

## Run locally
```bash
npm install          # also copies Stockfish into public/engine
npm run dev          # http://localhost:5173
npm test             # vitest (240 tests)
```
Set `VITE_API_URL` in `.env` to your Edge Function URL. Deploy the backend with `supabase db push` and `supabase functions deploy api --no-verify-jwt`; details are in `supabase/functions/api/README.md`.

## Deploy
- **GitHub Pages**: automatic on every push to `master` (`.github/workflows/pages.yml`).
- **Vercel**: `vercel.json` is included. Passkeys are bound to the domain, so changing hosts means adding a passkey on the new domain.

Not affiliated with chess.com or Lichess. GPL-3.0, because the bundled Stockfish engine is GPL-3.0.
