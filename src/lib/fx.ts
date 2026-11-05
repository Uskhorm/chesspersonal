import { animate, createTimeline, stagger, spring, utils } from 'animejs';
import confetti from 'canvas-confetti';
import type { Classification } from './types';

export const CLASS_COLOR: Record<Classification, string> = {
  brilliant: '#12b8a6',
  great: '#4c7ef3',
  best: '#5baa2e',
  excellent: '#7db33f',
  good: '#8fa88a',
  book: '#a07e5a',
  forced: '#8c96a3',
  inaccuracy: '#e9b300',
  mistake: '#f08a24',
  miss: '#e5484d',
  blunder: '#d7263d',
};

const layer = () => {
  let el = document.getElementById('fx-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fx-layer';
    document.body.appendChild(el);
  }
  return el;
};

/** Radial particle burst at a point — fired on every meaningful click. */
export function burst(x: number, y: number, color = '#f2b705', count = 10, spread = 60) {
  const root = layer();
  const parts: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = 'fx-particle';
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = color;
    const s = utils.random(4, 9);
    p.style.width = p.style.height = `${s}px`;
    root.appendChild(p);
    parts.push(p);
  }
  animate(parts, {
    translateX: () => utils.random(-spread, spread),
    translateY: () => utils.random(-spread, spread * 0.6) - 10,
    scale: [{ to: 1.3, duration: 120 }, { to: 0 }],
    opacity: [{ to: 1 }, { to: 0 }],
    rotate: () => utils.random(-180, 180),
    duration: () => utils.random(450, 750),
    ease: 'outExpo',
    onComplete: () => parts.forEach((p) => p.remove()),
  });
}

/** Floating "+12 XP" text that rises and fades. */
export function floatText(text: string, x: number, y: number, color = '#6b4f00', big = false) {
  const el = document.createElement('div');
  el.className = 'fx-float' + (big ? ' big' : '');
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.color = color;
  layer().appendChild(el);
  createTimeline({ onComplete: () => el.remove() })
    .add(el, { scale: [0.3, big ? 1.5 : 1.15], opacity: [0, 1], duration: 260, ease: 'outBack(3)' })
    .add(el, { translateY: -70, opacity: 0, duration: 900, ease: 'outCubic' }, '+=250');
}

export function shake(el: Element | null, intensity = 10) {
  if (!el) return;
  animate(el, {
    translateX: [0, -intensity, intensity, -intensity * 0.6, intensity * 0.6, -intensity * 0.3, 0],
    duration: 420,
    ease: 'inOutSine',
  });
}

export function pop(el: Element | null, scale = 1.25) {
  if (!el) return;
  animate(el, { scale: [{ to: scale, duration: 120 }, { to: 1, ease: spring({ bounce: 0.6, duration: 500 }) }] });
}

export function popIn(el: Element | null) {
  if (!el) return;
  animate(el, {
    scale: [0, 1],
    rotate: [-90, 0],
    opacity: [0, 1],
    ease: spring({ bounce: 0.55, duration: 650 }),
  });
}

export function staggerIn(targets: string | Element[] | NodeListOf<Element>, delay = 45) {
  animate(targets as Element[], {
    translateY: [24, 0],
    opacity: [0, 1],
    scale: [0.96, 1],
    delay: stagger(delay),
    duration: 650,
    ease: 'outExpo',
  });
}

/** Tween a number inside an element. */
export function countUp(el: HTMLElement | null, to: number, decimals = 0, duration = 1200, from = 0) {
  if (!el) return;
  const o = { v: from };
  animate(o, {
    v: to,
    duration,
    ease: 'outExpo',
    onUpdate: () => {
      el.textContent = o.v.toFixed(decimals);
    },
  });
}

export function flash(color: string) {
  const el = document.createElement('div');
  el.className = 'fx-flash';
  el.style.background = `radial-gradient(circle at 50% 50%, ${color}55, transparent 70%)`;
  layer().appendChild(el);
  animate(el, { opacity: [0, 1, 0], duration: 700, ease: 'outQuad', onComplete: () => el.remove() });
}

export function confettiBurst(colors: string[], power = 1, origin?: { x: number; y: number }) {
  confetti({
    particleCount: Math.round(90 * power),
    spread: 70 + 30 * power,
    startVelocity: 35 + 10 * power,
    origin: origin ?? { x: 0.5, y: 0.6 },
    colors,
    scalar: 1.05,
    disableForReducedMotion: true,
  });
}

export function fireworks() {
  const end = Date.now() + 1400;
  const colors = ['#f2b705', '#12b8a6', '#4c7ef3', '#1a1d24'];
  (function frame() {
    confetti({ particleCount: 6, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors });
    confetti({ particleCount: 6, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

export function celebrateClass(cls: Classification, origin?: { x: number; y: number }) {
  const c = CLASS_COLOR[cls];
  if (cls === 'brilliant') {
    confettiBurst([c, '#ffffff', '#7af7e6'], 1.4, origin);
    flash(c);
  } else if (cls === 'great') {
    confettiBurst([c, '#ffffff'], 0.8, origin);
  } else if (cls === 'blunder') {
    flash(c);
  }
}
