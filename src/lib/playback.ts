import { useEffect, useState, useSyncExternalStore } from 'react';
import { Chess } from 'chess.js';
import { describeMove } from './narrate';

export type PlaybackStep = { fen: string; lastMove?: [string, string]; label?: string };
export type PlaybackSpeed = 0.5 | 1 | 2;
export type PlaybackOptions = { interval?: number; autoplay?: boolean; loop?: boolean };
export type PlaybackState = {
  index: number; step: PlaybackStep | undefined; playing: boolean; progress: number; speed: PlaybackSpeed;
};

/** Invalid positions or moves throw, rather than producing a misleading partial line. */
export function buildSteps(fen: string, moves: string[]): PlaybackStep[] {
  const chess = new Chess(fen);
  const steps: PlaybackStep[] = [{ fen: chess.fen() }];
  for (const input of moves) {
    const before = chess.fen();
    const move = chess.move(input);
    steps.push({ fen: chess.fen(), lastMove: [move.from, move.to], label: describeMove(before, input) });
  }
  return steps;
}

/** Timer-backed external store; usable without a DOM for deterministic tests. */
export class PlaybackController {
  private steps: PlaybackStep[];
  private options: PlaybackOptions;
  private hidden = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private state: PlaybackState;

  constructor(steps: PlaybackStep[], opts: PlaybackOptions = {}) {
    this.steps = steps;
    this.options = opts;
    this.state = { index: 0, step: steps[0], playing: false, progress: 0, speed: 1 };
  }

  getSnapshot = (): PlaybackState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private clear() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private publish(patch: Partial<PlaybackState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private schedule() {
    this.clear();
    if (!this.state.playing || this.hidden || this.steps.length < 2) return;
    const interval = this.options.interval ?? 900;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const end = this.state.index >= this.steps.length - 1;
      this.moveTo(end && this.options.loop ? 0 : this.state.index + 1);
    }, (Number.isFinite(interval) && interval > 0 ? interval : 900) / this.state.speed);
  }
  private moveTo(index: number) {
    const max = Math.max(0, this.steps.length - 1);
    const next = Math.min(max, Math.max(0, Number.isFinite(index) ? Math.trunc(index) : 0));
    this.publish({ index: next, step: this.steps[next], progress: max ? next / max : 0,
      playing: this.state.playing && this.steps.length > 1 && (next < max || !!this.options.loop) });
    this.schedule();
  }
  configure(steps: PlaybackStep[], opts: PlaybackOptions = {}) {
    const changed = steps !== this.steps;
    this.steps = steps;
    this.options = opts;
    this.moveTo(changed ? 0 : this.state.index);
  }
  play = () => {
    if (this.hidden || this.steps.length < 2) return;
    if (this.state.index === this.steps.length - 1) this.moveTo(0);
    this.publish({ playing: true });
    this.schedule();
  };
  pause = () => { this.clear(); this.publish({ playing: false }); };
  toggle = () => { if (this.state.playing) this.pause(); else this.play(); };
  next = () => { this.moveTo(this.state.index + 1); };
  prev = () => { this.moveTo(this.state.index - 1); };
  seek = (index: number) => { this.moveTo(index); };
  setSpeed = (speed: PlaybackSpeed) => {
    if (speed !== 0.5 && speed !== 1 && speed !== 2) return;
    this.publish({ speed });
    this.schedule();
  };
  /** Hiding pauses playback; showing the document requires an explicit play. */
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    if (hidden) this.pause();
  }
  dispose = () => { this.clear(); };
}

export function usePlayback(steps: PlaybackStep[], opts: PlaybackOptions = {}) {
  const [controller] = useState(() => new PlaybackController(steps, opts));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.configure(steps, { interval: opts.interval, loop: opts.loop });
  }, [controller, steps, opts.interval, opts.loop]);
  useEffect(() => {
    const visibility = () => controller.setHidden(document.hidden);
    if (typeof document !== 'undefined') {
      visibility();
      document.addEventListener('visibilitychange', visibility);
    }
    if (opts.autoplay) controller.play();
    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility);
      controller.pause();
      controller.dispose();
    };
  }, [controller, opts.autoplay]);
  return { ...state, play: controller.play, pause: controller.pause, toggle: controller.toggle,
    next: controller.next, prev: controller.prev, seek: controller.seek, setSpeed: controller.setSpeed };
}
