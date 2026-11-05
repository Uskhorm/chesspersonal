// Builds src/data/openings.json from the CC0 lichess-org/chess-openings dataset.
// Maps every position (EPD) reached in a named opening line -> { eco, name }.
// Usage: node scripts/build-openings.mjs
import { Chess } from 'chess.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const base = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const map = {};
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const tsv = await (await fetch(`${base}${f}.tsv`)).text();
  for (const line of tsv.split('\n').slice(1)) {
    const [eco, name, pgn] = line.split('\t');
    if (!pgn) continue;
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
    for (let i = 0; i < sans.length; i++) {
      chess.move(sans[i]);
      const epd = chess.fen().split(' ').slice(0, 4).join(' ');
      // Final position of a line gets the line's exact name; intermediate keep first-seen.
      if (i === sans.length - 1 || !map[epd]) map[epd] = [eco, name];
    }
  }
}
mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/openings.json', JSON.stringify(map));
console.log(`openings: ${Object.keys(map).length} positions`);
