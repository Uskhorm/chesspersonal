// Separate isolates match browser Workers and avoid Stockfish's shared module
// factory state when require('stockfish') is called repeatedly in one isolate.
import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sf = require('stockfish')('lite-single', (line) => parentPort.postMessage(line));
parentPort.on('message', (command) => sf.processCommand(command));
