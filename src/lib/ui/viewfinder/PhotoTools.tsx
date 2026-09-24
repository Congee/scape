import { useRef } from 'react';
import { photoHfovDeg } from '@core/photo/fit';
import { photoStore, usePhoto } from '@state/photo';

/** Offset step in photo widths and rotation step in degrees; Shift takes ten. */
const STEP = 0.002;
const TURN_DEG = 0.1;

const NUDGES: [label: string, title: string, dx: number, dy: number, rot: number][] = [
  ['←', 'Photo left', -1, 0, 0],
  ['→', 'Photo right', 1, 0, 0],
  ['↑', 'Photo up', 0, 1, 0],
  ['↓', 'Photo down', 0, -1, 0],
  ['⟲', 'Rotate photo anticlockwise', 0, 0, -1],
  ['⟳', 'Rotate photo clockwise', 0, 0, 1]
];

/** Load a reference photo over the frame, fade it, and line it up. */
export function PhotoTools() {
  const p = usePhoto();
  const input = useRef<HTMLInputElement>(null);
  const { update } = photoStore.getState();
  return (
    <div className="vf-photo-tools chips" aria-label="Reference photo">
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        aria-label="Reference photo file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void photoStore.getState().load(f);
          e.target.value = '';
        }}
      />
      <button className={p.url ? 'on' : ''} onClick={() => input.current?.click()} title="Lay a photo over the frame, sized by its lens (Exif) or the current one">
        {p.url ? 'Replace photo' : 'Reference photo…'}
      </button>
      {p.url && (
        <>
          <button onClick={() => photoStore.getState().clear()} title="Remove the reference photo">
            Clear photo
          </button>
          <label className="opacity">
            <input type="range" min={0.05} max={1} step={0.05} value={p.opacity} onChange={(e) => update({ opacity: Number(e.target.value) })} aria-label="Photo opacity" />
            <span className="muted">{Math.round(p.opacity * 100)}%</span>
          </label>
          <span className="nudges">
            {NUDGES.map(([label, title, dx, dy, rot]) => (
              <button key={title} aria-label={title} title={`${title} (Shift: ×10)`} onClick={(e) => {
                const k = e.shiftKey ? 10 : 1;
                const s = photoStore.getState();
                update({ dx: s.dx + dx * STEP * k, dy: s.dy + dy * STEP * k, rotDeg: s.rotDeg + rot * TURN_DEG * k });
              }}>
                {label}
              </button>
            ))}
            <button onClick={() => update({ dx: 0, dy: 0, rotDeg: 0 })} disabled={!p.dx && !p.dy && !p.rotDeg} title="Undo the photo nudges">
              Reset
            </button>
          </span>
          <p className="muted hint">
            {p.name}: {p.focal35 ? `${p.focal35} mm equivalent (Exif), ${photoHfovDeg(p.focal35, p.w, p.h).toFixed(1)}° wide` : 'no Exif focal length, spans the frame at any lens'}
            {p.rotDeg ? `, turned ${p.rotDeg.toFixed(1)}°` : ''}
          </p>
        </>
      )}
      {p.error && <p className="error hint">{p.error}</p>}
    </div>
  );
}
