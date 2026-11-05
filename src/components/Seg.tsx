import { useId } from 'react';
import { motion } from 'motion/react';
import { spring } from './motion';

/** Segmented control with a shared-layout pill that slides to the selected option. */
export function Seg<T extends string>({ value, options, onChange, label, size, className }: {
  value: T;
  options: readonly (readonly [T, React.ReactNode])[];
  onChange: (v: T) => void;
  label: string;
  size?: 'lg';
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`seg ${size ?? ''} ${className ?? ''}`} role="group" aria-label={label}>
      {options.map(([k, text]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>
          {value === k && <motion.span layoutId={`seg-${id}`} className="seg-pill" transition={spring.snappy} />}
          {text}
        </button>
      ))}
    </div>
  );
}
