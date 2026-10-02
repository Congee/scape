/** Authored stroke icons; 1em square, drawn in currentColor. */
const PATHS = {
  right: 'M6 3l5 5-5 5',
  left: 'M10 3L5 8l5 5',
  out: 'M6 3h7v7M13 3L4 12',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
