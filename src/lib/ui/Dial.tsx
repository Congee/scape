import { DIAL_R, needleEnd } from './dialGeometry';

/** 14px bearing dial; the class picks the needle's sky ink. */
export function Dial({ az, ink, color }: { az: number; ink: string; color?: string }) {
  const tip = needleEnd(az);
  return (
    <svg className={`brg ${ink}`} viewBox="-7 -7 14 14" width="14" height="14" aria-hidden="true" style={color ? { color } : undefined}>
      <circle r={DIAL_R} />
      <line x1="0" y1="0" x2={tip.x.toFixed(2)} y2={tip.y.toFixed(2)} />
    </svg>
  );
}
