import { useEffect, useRef } from 'react';
import { createTimeline } from 'animejs';
import type { Classification } from '../lib/types';
import { CLASS_COLOR } from '../lib/fx';
import { ClassIcon, CLASS_LABEL } from './ClassIcon';

const PUNCT: Partial<Record<Classification, string>> = { brilliant: '!!', great: '!' };

/**
 * The verdict stamp — the one loud moment in the review. The word slams in,
 * a light sweep crosses it, and it settles.
 */
export function Verdict({ cls, san, moveNo, sub }: { cls: Classification; san: string; moveNo: string; sub?: string }) {
  const word = useRef<HTMLDivElement>(null);
  const sweep = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!word.current || !sweep.current) return;
    const good = cls === 'brilliant' || cls === 'great' || cls === 'best';
    const bad = cls === 'mistake' || cls === 'blunder' || cls === 'miss';
    const tl = createTimeline();
    tl.add(word.current.parentElement!, { scale: [1.08, 1], rotate: ['-4deg', '-1.2deg'], duration: 220, ease: 'outQuad' }).add(word.current, { opacity: [0, 1], translateY: [-6, 0], duration: 200, ease: 'outQuad' }, 0);
    if (good) tl.add(sweep.current, { translateX: ['-100%', '100%'], duration: 650, ease: 'inOutQuad' }, '-=120');
    if (bad) tl.add(word.current.parentElement!, { translateX: [0, -6, 6, -3, 3, 0], duration: 260, ease: 'inOutSine' }, '-=40');
    return () => {
      tl.revert();
    };
  }, [cls, san, moveNo]);
  const quiet = cls === 'book' || cls === 'forced' || cls === 'good';
  return (
    <div className={`verdict stamp ${quiet ? 'neutral' : ''}`} style={{ ['--vc' as string]: CLASS_COLOR[cls] }}>
      <div ref={sweep} className="verdict-sweep" />
      <div ref={word} className="verdict-word display">
        <ClassIcon cls={cls} size={44} white={!quiet} />
        <span>
          {CLASS_LABEL[cls]}
          {PUNCT[cls] ?? ''}
        </span>
      </div>
      <div className="verdict-move num">
        {moveNo} {san}
        {sub ? <span style={{ opacity: 0.8, fontWeight: 500 }}> {sub}</span> : null}
      </div>
    </div>
  );
}
