import { useRef } from 'react';

export interface SegOption<T extends string> {
  value: T;
  label: string;
  title?: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: readonly SegOption<T>[];
  onChange: (v: T) => void;
  className?: string;
  /** Each option's value lands on `data-<dataKey>`. */
  dataKey?: string;
}

/** One-of choice as a radiogroup; arrows move and select, skipping disabled options. */
export function Segmented<T extends string>({ label, value, options, onChange, className, dataKey }: Props<T>) {
  const box = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = options.length;
    let i = options.findIndex((o) => o.value === value);
    for (let k = 0; k < n; k++) {
      i = (i + step + n) % n;
      if (!options[i].disabled) break;
    }
    if (options[i].disabled) return;
    onChange(options[i].value);
    box.current?.querySelectorAll<HTMLButtonElement>('[role=radio]')[i]?.focus();
  };
  // A disabled or unmatched value would otherwise leave the group without a tab stop.
  const stop = options.some((o) => o.value === value && !o.disabled) ? value : options.find((o) => !o.disabled)?.value;
  return (
    <div className={className ? `segmented ${className}` : 'segmented'} role="radiogroup" aria-label={label} ref={box} onKeyDown={onKey}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === stop ? 0 : -1}
          title={o.title}
          disabled={o.disabled}
          {...(dataKey ? { [`data-${dataKey}`]: o.value } : {})}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
