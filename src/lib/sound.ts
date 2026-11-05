import { useStore } from './store';

/** All sounds are synthesised with WebAudio — no audio assets to download. */
let ctx: AudioContext | null = null;
const ac = () => {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};
const on = () => useStore.getState().settings.sound;

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; when?: number; slide?: number } = {}) {
  const c = ac();
  const t = c.currentTime + (opts.when ?? 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.18, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function knock(freq: number, gain = 0.5, dur = 0.07) {
  const c = ac();
  const t = c.currentTime;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 2.5;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1567.98, 1760, 2093];

export const sfx = {
  move: () => on() && knock(1400, 0.9),
  capture: () => on() && (knock(700, 1.2, 0.1), knock(1800, 0.4)),
  check: () => on() && (knock(1200, 0.9), tone(880, 0.12, { type: 'triangle', gain: 0.08 })),
  click: () => on() && tone(1200, 0.05, { type: 'triangle', gain: 0.05, slide: 1600 }),
  hover: () => on() && tone(2400, 0.02, { type: 'sine', gain: 0.015 }),
  correct: () => {
    if (!on()) return;
    [0, 4, 7, 12].forEach((s, i) => tone(523.25 * 2 ** (s / 12), 0.22, { type: 'triangle', gain: 0.12, when: i * 0.06 }));
  },
  /** Rising pitch with each combo step — a classic dopamine ladder. */
  combo: (n: number) => {
    if (!on()) return;
    const f = NOTES[Math.min(n, NOTES.length - 1)];
    tone(f, 0.18, { type: 'square', gain: 0.05 });
    tone(f * 1.5, 0.25, { type: 'triangle', gain: 0.08, when: 0.05 });
  },
  wrong: () => {
    if (!on()) return;
    tone(220, 0.25, { type: 'sawtooth', gain: 0.06, slide: 110 });
    tone(233, 0.25, { type: 'square', gain: 0.03, slide: 116 });
  },
  brilliant: () => {
    if (!on()) return;
    [0, 7, 12, 16, 19, 24].forEach((s, i) => tone(659.25 * 2 ** (s / 12), 0.5, { type: 'sine', gain: 0.1, when: i * 0.07 }));
    tone(2637, 0.8, { type: 'sine', gain: 0.03, when: 0.4 });
  },
  great: () => {
    if (!on()) return;
    [0, 5, 9].forEach((s, i) => tone(587.33 * 2 ** (s / 12), 0.3, { type: 'triangle', gain: 0.1, when: i * 0.07 }));
  },
  blunder: () => {
    if (!on()) return;
    tone(300, 0.5, { type: 'sawtooth', gain: 0.05, slide: 80 });
  },
  levelUp: () => {
    if (!on()) return;
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(392 * 2 ** (s / 12), 0.35, { type: 'square', gain: 0.05, when: i * 0.08 }));
    [12, 16, 19, 24].forEach((s) => tone(392 * 2 ** (s / 12), 1.2, { type: 'triangle', gain: 0.06, when: 0.6 }));
  },
  chest: () => {
    if (!on()) return;
    for (let i = 0; i < 12; i++) tone(400 + i * 90, 0.08, { type: 'square', gain: 0.03, when: i * 0.05 });
    [0, 4, 7, 12].forEach((s) => tone(783.99 * 2 ** (s / 12), 1, { type: 'triangle', gain: 0.07, when: 0.65 }));
  },
  xp: () => on() && tone(1760, 0.08, { type: 'sine', gain: 0.05, slide: 2637 }),
};
