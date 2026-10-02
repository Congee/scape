/** Authored stroke icons; 1em square, drawn in currentColor. */
const PATHS = {
  right: 'M6 3l5 5-5 5',
  left: 'M10 3L5 8l5 5',
  out: 'M6 3h7v7M13 3L4 12',
  down: 'M3 6l5 5 5-5',
  leftDouble: 'M8 3L3 8l5 5M13 3L8 8l5 5',
  rightDouble: 'M3 3l5 5-5 5M8 3l5 5-5 5',
  search: 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM11 11l3.5 3.5',
  calendar: 'M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 1.5v3M10.5 1.5v3',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
