import { useRef } from 'react';
import { photoHfovDeg } from '@core/photo/fit';
import { photoStore, usePhoto } from '@state/photo';
import { Icon, type IconName } from '../Icon';
import { FormRow } from '../Section';

/** Offset step in photo widths and rotation step in degrees; Shift takes ten. */
const STEP = 0.002;
const TURN_DEG = 0.1;

const NUDGES: [icon: IconName, title: string, dx: number, dy: number, rot: number][] = [
  ['arrowLeft', 'Photo left', -1, 0, 0],
  ['arrowRight', 'Photo right', 1, 0, 0],
  ['arrowUp', 'Photo up', 0, 1, 0],
  ['arrowDown', 'Photo down', 0, -1, 0],
  ['turnLeft', 'Rotate photo anticlockwise', 0, 0, -1],
  ['turnRight', 'Rotate photo clockwise', 0, 0, 1]
];

/** Load a reference photo over the frame, fade it, and line it up. */
export function PhotoTools() {
  const p = usePhoto();
  const input = useRef<HTMLInputElement>(null);
  const { update } = photoStore.getState();
  const pick = () => input.current?.click();
  return (
    <div className="vf-photo-tools">
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
      <FormRow label="Photo">
        <button className="blank" onClick={pick} title="Lay a photo over the frame, sized by its lens (Exif) or else locked to the current one">
          {p.url ? p.name : 'Choose a photo…'}
        </button>
      </FormRow>
      {p.url && (
        <>
          <div className="brow">
            <span className="label">{p.fromExif ? 'Exif focal' : 'Lens at load'}</span>
            <span className="time">{Math.round(p.focal35)} mm</span>
            <span className="az">{photoHfovDeg(p.focal35, p.w, p.h).toFixed(1)}°</span>
            <span className="note hint">
              {p.fromExif ? `${p.focal35} mm equivalent (Exif)` : `no Exif focal length, locked to the lens at load (${Math.round(p.focal35)} mm equivalent)`}, horizontal field of view
              {p.rotDeg ? `, turned ${p.rotDeg.toFixed(1)}°` : ''}
            </span>
          </div>
          <FormRow label="Opacity">
            <span className="vrange">
              <input type="range" min={0.05} max={1} step={0.05} value={p.opacity} onChange={(e) => update({ opacity: Number(e.target.value) })} aria-label="Photo opacity" />
              <span>{Math.round(p.opacity * 100)} %</span>
            </span>
          </FormRow>
          <FormRow label="Nudge">
            <span className="nudge">
              {NUDGES.map(([icon, title, dx, dy, rot]) => (
                <button
                  key={title}
                  aria-label={title}
                  title={`${title} (Shift ×10)`}
                  onClick={(e) => {
                    const k = e.shiftKey ? 10 : 1;
                    const s = photoStore.getState();
                    update({ dx: s.dx + dx * STEP * k, dy: s.dy + dy * STEP * k, rotDeg: s.rotDeg + rot * TURN_DEG * k });
                  }}
                >
                  <Icon name={icon} />
                </button>
              ))}
            </span>
            <span className="actions">
              <button onClick={() => update({ dx: 0, dy: 0, rotDeg: 0 })} disabled={!p.dx && !p.dy && !p.rotDeg} title="Undo the photo nudges">
                Reset
              </button>
            </span>
          </FormRow>
          <div className="actions">
            <button onClick={pick} title="Pick another photo">
              Replace
            </button>
            <button onClick={() => photoStore.getState().clear()} aria-label="Clear photo" title="Remove the reference photo">
              Clear
            </button>
          </div>
        </>
      )}
      {p.error && <p className="error hint">{p.error}</p>}
    </div>
  );
}
