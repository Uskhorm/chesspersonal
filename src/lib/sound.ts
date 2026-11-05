import { useStore } from './store';

/** Asset-free, gently enveloped WebAudio effects. */
let ctx: AudioContext | null = null;
let output: GainNode;
let reverb: ConvolverNode;
let volume = 0.6;
export function setVolume(v: number): void {
  if (Number.isFinite(v)) volume = Math.max(0, Math.min(1, v));
}
export function getVolume(): number { return volume; }

function audio(): AudioContext | null {
  if (!useStore.getState().settings.sound || volume === 0 || typeof window === 'undefined') return null;
  const Audio = window.AudioContext;
  if (!Audio) return null;
  try {
    if (!ctx || ctx.state === 'closed') {
      ctx = new Audio();
      output = ctx.createGain();
      output.connect(ctx.destination);
      reverb = ctx.createConvolver();
      const impulse = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * 0.28), ctx.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 4 * 0.22;
      }
      reverb.buffer = impulse;
      const wet = ctx.createGain();
      wet.gain.value = 0.12;
      reverb.connect(wet).connect(output);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const quiet = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    output.gain.setTargetAtTime(volume * (quiet ? 0.3 : 1), ctx.currentTime, 0.012);
    return ctx;
  } catch { return null; }
}

function tone(c: AudioContext, frequency: number, delay = 0, duration = 0.25, gain = 0.09, wet = true) {
  const t = c.currentTime + delay;
  const oscillator = c.createOscillator();
  const envelope = c.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0, t);
  envelope.gain.linearRampToValueAtTime(gain, t + 0.015);
  envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  envelope.gain.linearRampToValueAtTime(0, t + duration + 0.015);
  oscillator.connect(envelope).connect(output);
  if (wet) envelope.connect(reverb);
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  oscillator.start(t);
  oscillator.stop(t + duration + 0.02);
}

function knock(c: AudioContext, deep = false, delay = 0) {
  const t = c.currentTime + delay;
  const noise = c.createBuffer(1, Math.ceil(c.sampleRate * 0.055), c.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const source = c.createBufferSource();
  source.buffer = noise;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = deep ? 650 : 1100;
  filter.Q.value = 0.8;
  const envelope = c.createGain();
  envelope.gain.setValueAtTime(0, t);
  envelope.gain.linearRampToValueAtTime(0.3, t + 0.002);
  envelope.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  source.connect(filter).connect(envelope).connect(output);
  source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
  source.start(t);
  source.stop(t + 0.065);
  tone(c, deep ? 145 : 205, delay, 0.085, deep ? 0.16 : 0.11, false);
}

function play(effect: (c: AudioContext) => void): void {
  const c = audio();
  if (c) effect(c);
}
function chime(notes: number[], base = 440, spacing = 0.065): void {
  play(c => notes.forEach((note, i) => tone(c, base * 2 ** (note / 12), i * spacing, 0.3, 0.075 / Math.sqrt(notes.length))));
}

export const sfx = {
  move: (): void => play(c => knock(c)),
  capture: (): void => play(c => { knock(c, true); knock(c, true, 0.045); }),
  check: (): void => play(c => { knock(c); tone(c, 660, 0.03, 0.18, 0.045); }),
  castle: (): void => play(c => { knock(c); knock(c, true, 0.075); }),
  promote: (): void => chime([0, 7, 12], 523.25),
  notify: (): void => chime([0, 7], 440, 0.1),
  click: (): void => play(c => tone(c, 600, 0, 0.055, 0.025, false)),
  hover: (): void => {
    if (typeof window !== 'undefined' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      play(c => tone(c, 740, 0, 0.04, 0.008, false));
    }
  },
  correct: (): void => chime([0, 4, 7], 523.25),
  combo: (n: number): void => {
    const step = Number.isFinite(n) ? Math.max(0, Math.min(10, Math.floor(n))) : 0;
    chime([0, 7], 440 * 2 ** (step / 12));
  },
  wrong: (): void => chime([0, -3], 330, 0.09),
  brilliant: (): void => chime([0, 7, 12, 16], 523.25),
  great: (): void => chime([0, 4, 9], 440),
  blunder: (): void => chime([0, -5], 261.63, 0.1),
  levelUp: (): void => chime([0, 4, 7, 12, 16], 392),
  chest: (): void => chime([0, 7, 4, 12], 440, 0.085),
  xp: (): void => chime([0, 7], 660, 0.04),
};
