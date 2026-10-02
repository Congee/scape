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
  arrowLeft: 'M13 8H3M7 4L3 8l4 4',
  arrowRight: 'M3 8h10M9 4l4 4-4 4',
  arrowUp: 'M8 13V3M4 7l4-4 4 4',
  arrowDown: 'M8 3v10M4 9l4 4 4-4',
  turnLeft: 'M4 8a4 4 0 1 1 1.2 2.9M4 11.5V8h3.5',
  turnRight: 'M12 8a4 4 0 1 0-1.2 2.9M12 11.5V8H8.5',
  alert: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 4.5v4M8 11v.5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
