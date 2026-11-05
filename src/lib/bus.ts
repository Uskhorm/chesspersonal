/** Tiny event bus so game logic can trigger celebrations anywhere in the UI. */
export type FxEvent =
  | { type: 'xp'; amount: number; x?: number; y?: number; crit?: boolean }
  | { type: 'levelup'; level: number; title: string }
  | { type: 'quest'; label: string; reward: number }
  | { type: 'achievement'; id: string; label: string; emoji: string }
  | { type: 'chest'; rarity: Rarity; xp: number; extra?: string }
  | { type: 'toast'; text: string; tone?: 'good' | 'bad' | 'info'; emoji?: string; onClick?: () => void };

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

type Listener = (e: FxEvent) => void;

/** While a training session is in focus, non-essential toasts wait until it ends. */
let quiet = false;
const held: FxEvent[] = [];
export function setQuiet(q: boolean) {
  quiet = q;
  if (!q) for (const e of held.splice(0)) emit(e);
}
const listeners = new Set<Listener>();

export function emit(e: FxEvent) {
  if (quiet && e.type === 'toast') {
    held.push(e);
    return;
  }
  for (const l of listeners) l(e);
}

export function onFx(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
