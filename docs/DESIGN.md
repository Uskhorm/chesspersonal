# Hindsight design system (v3)

The brief from the owner: dark mode, a board you can actually play on, plain English instead of SAN, lines that play out instead of a slideshow, and motion that feels professional — snappy, fast, fluid.

Direction in one line: **the board is the hero; the chrome is a quiet instrument around it.** Colour is reserved for meaning (green = the good move / correct, red = what cost you, gold = progress), so the move-quality language reads instantly against neutral graphite and paper.

## Sources and what we took from them

| Source | Principle applied here |
|---|---|
| Emil Kowalski, *Great animations* and *7 practical animation tips* (emilkowal.ski) | UI motion under 300 ms; strong custom ease-out for entering elements; press feedback `scale(0.97)`; never animate from `scale(0)` (we start at 0.6–0.98); animate only `transform`/`opacity`; remove motion from high-frequency actions (move list, arrows on the board snap). |
| Rauno Freiberg, *Interaction design* (rauno.me/craft) | Apply input immediately (the board moves the instant you drop a piece; engine lines update in place); interruptible animation (line playback can be paused, scrubbed or exited mid-move); confirm selections briefly (tick/cross on the board, then get out of the way). |
| Motion (motion.dev) transitions docs | Springs as `visualDuration` + `bounce`, so springs line up with CSS duration tokens; shared-layout pills (`layoutId`) for nav and segmented controls; `MotionConfig reducedMotion="user"`. |
| Josh Comeau, *A friendly introduction to spring physics* | Springs for movement, tweens for colour/opacity; mostly non-bouncy springs, bounce kept for rewards. |
| Radix Colors, *Understanding the scale* | Neutral scale by role: 1–2 app/subtle backgrounds, 3–5 element normal/hover/pressed, 6–8 borders, 11–12 text. Dark mode has its **own** steps, not an inversion. |
| Linear, *How we redesigned the Linear UI* | Few inputs generate the theme (base, accent, contrast); reduce accent use for a calmer, timeless look; darker text in light mode / lighter in dark for content contrast. |
| Vercel Geist | Monochrome primary buttons (ink on paper / paper on ink), one accent for focus and info. |
| Lichess analysis board, chess.com Game Review | Free exploration from any position with a variation tree and breadcrumbs, top engine lines with eval pills, eval bar, game graph you can scrub, "back to game". |
| Duolingo / chess.com puzzles | Multimodal feedback: colour + icon + sound + short text; correct is a quick, satisfying pop; wrong is clear but brief and the piece snaps back. |
| dataviz skill (bundled) | Single-series charts without legend boxes, recessive grid, one direct end label, crosshair + tooltip on hover, 2 px gaps between segmented fills, text in ink tokens not series colours. |

## Tokens (src/styles.css)

### Colour
Light and dark are separate token sets on `:root` and `:root[data-theme='dark']`. `theme.ts` (X7) resolves system/light/dark and sets `data-theme`; `index.html` runs the same logic inline before CSS paints, so there is no flash.

| Role | Light | Dark |
|---|---|---|
| `--bg` app | `#faf9f6` | `#17191c` |
| `--surface` card | `#ffffff` | `#1e2024` |
| `--surface-2/3/4` element / hover / pressed | `#f5f4f1 / #eceae6 / #e2e0db` | `#24272c / #2c2f35 / #353940` |
| `--line / -2 / -3` borders | `#e8e6e1 / #d8d5cf / #bdb9b2` | `#2a2d32 / #393d44 / #50545c` |
| `--ink / -2 / -3` text | `#18191b / #4a4c51 / #6b6d73` | `#edebe7 / #b9b7b2 / #93949a` |
| `--good` text / `--good-fill` | `#1f7a36 / #23853b` (white text) | `#62cf78 / #3fb45a` (dark text) |
| `--bad` / `--bad-fill` | `#c0283a / #d7263d` | `#ff7482 / #e5394f` |
| `--accent` focus, info | `#2f5fd8` | `#86a8ff` |
| `--gold` XP | `#f2b705`, ink `#7a5600` | ink `#f5c84b` |

All body text pairs meet WCAG AA (≥ 4.5:1); `--ink-3` is the lowest text step and is ≥ 4.5:1 on `--bg` and `--surface` in both themes. `--ink-4` is decorative only. Move-quality colours (`--c-brilliant` … `--c-blunder`) are fills behind white glyphs; when used as text they are mixed toward ink (`color-mix(in oklab, …, var(--ink))`).

### Type
One family, Archivo variable (width + weight axes). Display uses `wdth 74, wght 780, -0.018em` — condensed, confident numbers and headings. Body is `wdth 100, wght 420`. Scale: 11 / 12 / 13 / 14 / 15 / 16 / 18 / 20 / 24 / 30 / 38 / 48 / 64. Numbers are always `tabular-nums`. SAN appears only as a small secondary label (`.san`: 0.86em, `wdth 88`, `--ink-3`); primary text is plain English from `narrate.ts`.

### Space, radius, elevation
4 pt spacing (`--s-1` … `--s-12`). Radius encodes hierarchy, not one value everywhere: 4 (ticks), 7 (chips, board), 10 (buttons, inputs, rows), 14 (cards), 20 (sheets). Shadows are two-layer and soft in light mode; in dark mode elevation is carried by surface steps and hairlines.

### Motion (`src/components/motion.ts` + CSS)
| Token | Value | Use |
|---|---|---|
| `--d-press` | 90 ms | `:active` scale 0.97 |
| `--d-fast` | 140 ms | hover colour, borders |
| `--d-base` | 200 ms | enter, toggles |
| `--d-slow` | 320 ms | theme cross-fade |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | everything entering |
| `spring.snappy` | visualDuration 0.22, bounce 0.12 | nav pill, segmented control, status pill |
| `spring.smooth` | visualDuration 0.30, bounce 0 | layout changes, panels, toasts |
| `spring.pop` | visualDuration 0.32, bounce 0.38 | rewards: tick, badges, level number |

Rules:
- Route changes are **enter-only** (`motion.main key=route`, 180 ms fade+4 px rise). No `AnimatePresence mode="wait"` on routes, so navigation can never get stuck.
- Lists stagger with `staggerDelay(i, n)`, capped so the whole list lands in ≈ 220 ms.
- Board pieces animate 180 ms only for single-move changes; jumps snap.
- The eval bar, scrubbers and meters animate one `transform` each.
- `prefers-reduced-motion`: `MotionConfig reducedMotion="user"` plus a global CSS override; the number ticker writes the final value immediately.

## Component rules

- **Board** (`Board.tsx`): `marks` (tinted squares: good/bad/hint/focus rings) use chessground's `highlight.custom`, so they live in the board's own render. `feedback` shows a small tick/cross that pops and fades in 720 ms. `sound` plays move/capture/check/castle on single-move changes. `still` for thumbnails.
- **Analysis board** (`pages/Review.tsx`): every position is playable. Moves off the game line go into `useExplorer`; breadcrumbs show the variation in plain English with "Back to game". Live top-3 engine lines (arrows: best solid, 2nd/3rd faint), hover a line to isolate its arrow, click to play it, ▶ to watch it play out. "Play the better move" and "What it allowed" run through `usePlayback` with play/pause/step/scrub/speed.
- **Puzzle panel** (`components/Puzzle.tsx`, used by Learn and Train): one `Status` line that morphs between checking / wrong / hint / solved instead of stacking alerts; hints are cumulative on the board; explanation `points` light their squares as you hover, focus or tap them.
- **Buttons**: `.btn` + one of `primary` (ink), `go` (the one green action per screen), `ghost`, `subtle`, `danger`; sizes `sm` / default / `lg`. 44 px minimum on touch.
- **Segmented control** (`Seg.tsx`): the selected pill is a shared-layout element that slides.
- **Skeletons** hold the final layout's size; spinners appear only inside buttons.
- **Keyboard**: ←/→ moves, Home/End, F flip, E engine, N next mistake, Space play/pause, H hint, S show me, Enter continue, / type a move, Esc exit session.

## Things deliberately avoided
Purple gradients, glassmorphism (only the sticky bars blur), emoji in UI copy (toasts strip emoji coming from the library layer), gradient text, all-caps labels, identical card grids (insight cards vary in span; Train uses one hero + two rows, not three equal tiles).
