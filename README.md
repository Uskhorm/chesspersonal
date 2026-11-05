<img src="assets/icon.svg" width="64" height="64" alt="">

# ChessPersonal

**An open-source, in-house version of chess game review — plus a training system built from your own mistakes.**

Connect your chess.com username, and every game you finish is pulled in, analysed by Stockfish 19 in your browser, and broken down move by move into **Brilliant · Great · Best · Excellent · Good · Book · Inaccuracy · Mistake · Miss · Blunder**. Each mistake you make becomes a flashcard you drill on spaced repetition until you stop making it.

## Features

### Game review
- **Auto-sync from chess.com**: polls the public API every minute while the app is open and reviews new games automatically. No password is needed; games are public by username.
- **Stockfish 19 (WASM)** runs locally in parallel Web Workers (up to 4). **Lichess cloud eval** is used for opening positions where it's available.
- **Expected-points move classification**: Brilliant (sound sacrifices, detected with static exchange evaluation), Great (only-moves that change the outcome), Miss (failing to punish your opponent's error), Book (≈8,000 positions from the lichess opening book), and the rest.
- **Accuracy and estimated game rating** per side, plus accuracy by phase (opening / middlegame / endgame).
- **Coach panel** that explains each move: what it hangs, mates it allows, the best line, and motif tags.
- **Retry** any of your mistakes. Different good moves also count, because answers are checked by the engine.

### Learning system
| Technique | How it's used |
|---|---|
| **Spaced repetition** (SM-2) | Every mistake, miss and blunder becomes a card that comes back just before you'd forget it |
| **Retrieval practice** | *Learn mode* makes you find the better move yourself before showing the answer |
| **Interleaving** | Sessions rotate across motifs instead of drilling one pattern in a block |
| **85% rule** (Wilson et al., 2019) | Session difficulty adapts toward an ~85% success rate |
| **Deliberate practice** | The *Elo leak report* ranks your points lost by motif (hanging pieces, missed forks, missed mates, time trouble…) and targets Lichess puzzles at your #1 leak |

### The fun part
XP and levels, daily quests, streaks with streak freezes, loot chests with random rarity drops (board-theme unlocks), combo multipliers with rising-pitch sound, critical-hit XP, a training rating that moves with every solve, Blunder Rush (3 min, 3 lives), achievements, and particle and confetti effects on nearly every click. Animations use **anime.js v4** and **Motion**, and all sounds are synthesised with WebAudio.

## Stack
React 19 · Vite · TypeScript · [chess.js](https://github.com/jhlywa/chess.js) · [chessground](https://github.com/lichess-org/chessground) · [Stockfish.js](https://github.com/nmrugg/stockfish.js) · [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) · [anime.js](https://animejs.com) · [Motion](https://motion.dev) · [canvas-confetti](https://github.com/catdad/canvas-confetti) · Dexie (IndexedDB) · Zustand

APIs: [chess.com Published-Data API](https://www.chess.com/news/view/published-data-api), [Lichess cloud eval & puzzles](https://lichess.org/api).

All data stays on your device (IndexedDB + localStorage). There is no backend.

## Run locally
```bash
npm install        # also copies the Stockfish engine into public/engine
npm run dev
```
Regenerate the opening book with `node scripts/build-openings.mjs`.

## Deploy
It's a static site, so `npm run build` outputs `dist/`. The repo is configured for Vercel (`vercel.json`).

## Notes
- Classifications follow the publicly described expected-points model, but the thresholds are this project's own, so results won't match chess.com exactly.
- Not affiliated with chess.com or Lichess.

## License
GPL-3.0, because the bundled Stockfish engine is GPL-3.0. See [LICENSE](LICENSE).
