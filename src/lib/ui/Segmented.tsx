import { useRef } from 'react';

interface Props<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}

/** One-of choice as a radiogroup; arrows move and select. */
export function Segmented<T extends string>({ label, value, options, onChange }: Props<T>) {
  const box = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = (options.findIndex((o) => o.value === value) + step + options.length) % options.length;
    onChange(options[i].value);
    box.current?.querySelectorAll<HTMLButtonElement>('[role=radio]')[i]?.focus();
  };
  return (
    <div className="segmented" role="radiogroup" aria-label={label} ref={box} onKeyDown={onKey}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
