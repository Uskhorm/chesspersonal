// Copies the Stockfish 19 (lite, single-threaded) WASM engine into /public/engine
// so it can be served as a static Web Worker. Runs automatically on `npm install`.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const out = join(root, 'public', 'engine');
if (!existsSync(src)) {
  console.warn('[copy-engine] stockfish package not found, skipping');
  process.exit(0);
}
mkdirSync(out, { recursive: true });
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  copyFileSync(join(src, f), join(out, f));
}
console.log('[copy-engine] Stockfish 19 lite copied to public/engine');
