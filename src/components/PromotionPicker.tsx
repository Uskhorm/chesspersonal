import { createElement, useEffect, useRef } from 'react';

export type PromotionRole = 'q' | 'n' | 'r' | 'b';
const choices = [
  ['q', 'queen'], ['n', 'knight'], ['r', 'rook'], ['b', 'bishop'],
] as const;

interface Props {
  square: string;
  color: 'white' | 'black';
  orientation: 'white' | 'black';
  onChoose: (role: PromotionRole) => void;
  onCancel: () => void;
}

export function PromotionPicker({ square, color, orientation, onChoose, onCancel }: Props) {
  const column = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChoose, onCancel });
  callbacks.current = { onChoose, onCancel };
  const file = square.charCodeAt(0) - 97;
  const fromTop = (square[1] === '8') === (orientation === 'white');

  useEffect(() => {
    const previous = document.activeElement;
    const returnFocus = previous instanceof HTMLElement && previous !== document.body
      ? previous
      : column.current?.closest('.board-wrap')?.querySelector<HTMLElement>('.cg-host');
    const buttons = () => Array.from(column.current?.querySelectorAll('button') ?? []);
    buttons()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const choice = choices.find(([role]) => role === key);
      if (key === 'escape' || choice || key === 'tab' || key === 'arrowdown' || key === 'arrowup') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (key === 'escape') callbacks.current.onCancel();
        else if (choice) callbacks.current.onChoose(choice[0]);
        else {
          const items = buttons();
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const step = key === 'arrowup' || (key === 'tab' && event.shiftKey) ? -1 : 1;
          items[(current + step + items.length) % items.length]?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="promotion-overlay" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
      <div className="promotion-backdrop" onClick={onCancel} aria-hidden="true" />
      <div
        ref={column}
        className="promotion-column cg-wrap"
        style={{ left: `${(orientation === 'white' ? file : 7 - file) * 12.5}%`, top: fromTop ? 0 : '50%', flexDirection: fromTop ? 'column' : 'column-reverse' }}
      >
        {choices.map(([role, name]) => (
          <button key={role} type="button" className="promotion-choice" aria-label={`Promote to ${name}`} aria-keyshortcuts={role.toUpperCase()} title={`${name[0].toUpperCase() + name.slice(1)} (${role.toUpperCase()})`} onClick={() => onChoose(role)}>
            {createElement('piece', { className: `${color} ${name}`, 'aria-hidden': true })}
          </button>
        ))}
      </div>
    </div>
  );
}
