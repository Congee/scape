import { LightMode } from '@core/astro/lightSource';
import { settingsStore, useSettings } from '@state/settings';

const LIGHT: [LightMode, string, string][] = [
  [LightMode.Auto, 'Auto', 'Sun by day, moon by night: the moon takes over once it is up and the sun is 6° below the horizon'],
  [LightMode.Sun, 'Sun', 'Sun only'],
  [LightMode.Moon, 'Moon', 'Moon only']
];

/** Shadow light source, shared by the map's layers and the viewfinder's scene. */
export function LightSeg() {
  const lightSource = useSettings((s) => s.lightSource);
  return (
    <div className="seg" role="radiogroup" aria-label="Light source for shadows">
      {LIGHT.map(([m, label, title]) => (
        <button key={m} role="radio" aria-checked={lightSource === m} className={lightSource === m ? 'on' : ''} title={title} onClick={() => settingsStore.getState().update({ lightSource: m })}>
          {label}
        </button>
      ))}
    </div>
  );
}
