import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Keyboard } from 'lucide-react';
import { parseMoveInput } from '../lib/moveinput';
import { spring } from './motion';

/**
 * Type a move instead of dragging: "knight f3", "takes on e5", "castle short", "Nf3", "g1f3".
 * Press / anywhere to focus it.
 */
export function MoveInput({ fen, onMove, disabled, placeholder = 'Type a move, like "knight to f3"' }: {
  fen: string;
  onMove: (from: string, to: string, promotion?: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setErr(null);
  }, [fen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      ref.current?.focus();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (
    <form
      className="move-input grow"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        const r = parseMoveInput(fen, text);
        if ('error' in r) {
          setErr(r.error);
          return;
        }
        setText('');
        setErr(null);
        onMove(r.uci.slice(0, 2), r.uci.slice(2, 4), r.uci[4]);
      }}
    >
      <Keyboard aria-hidden="true" />
      <input
        ref={ref}
        className="input"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          if (err) setErr(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setText('');
            setErr(null);
            ref.current?.blur();
          }
        }}
        placeholder={placeholder}
        aria-label="Type a move"
        aria-invalid={!!err}
        aria-describedby={err ? 'move-input-err' : undefined}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="go"
      />
      <AnimatePresence>
        {err && (
          <motion.div id="move-input-err" role="alert" className="err-pop" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }} transition={spring.snappy}>
            {err}
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}
