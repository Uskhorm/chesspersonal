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
const listeners = new Set<Listener>();

export function emit(e: FxEvent) {
  for (const l of listeners) l(e);
}

export function onFx(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
