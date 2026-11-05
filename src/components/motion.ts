import type { Transition } from 'motion/react';

/**
 * Motion tokens. Springs are expressed as visualDuration + bounce (motion.dev) so
 * they line up with the CSS duration tokens in styles.css.
 * Rule of thumb: UI responds in under 200 ms; nothing the user waits on exceeds 300 ms.
 */
export const spring = {
  /** Presses, toggles, pills sliding under nav items. */
  snappy: { type: 'spring', visualDuration: 0.22, bounce: 0.12 } as Transition,
  /** Panels and cards changing size or position (layout animations). */
  smooth: { type: 'spring', visualDuration: 0.3, bounce: 0 } as Transition,
  /** Rewards: correct answers, badges, level numbers. One overshoot, then settle. */
  pop: { type: 'spring', visualDuration: 0.32, bounce: 0.38 } as Transition,
} as const;

export const ease = {
  out: [0.23, 1, 0.32, 1] as [number, number, number, number],
  inOut: [0.77, 0, 0.175, 1] as [number, number, number, number],
};

/** Content entering the screen: short rise + fade, never from scale 0. */
export const enter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: ease.out },
};

/** Stagger children so a whole list lands in under ~250 ms regardless of length. */
export function staggerDelay(i: number, total: number, budget = 0.22) {
  const step = Math.min(0.035, budget / Math.max(1, total));
  return Math.min(i, 12) * step;
}
