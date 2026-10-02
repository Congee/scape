import { LightMode } from '@core/astro/lightSource';
import { settingsStore, useSettings } from '@state/settings';
import { Segmented } from './Segmented';

const LIGHT: [LightMode, string, string][] = [
  [LightMode.Auto, 'Auto', 'Sun by day, moon by night: the moon takes over once it is up and the sun is 6° below the horizon'],
  [LightMode.Sun, 'Sun', 'Sun only'],
  [LightMode.Moon, 'Moon', 'Moon only']
];

/** Shadow light source, shared by the map's layers and the viewfinder's scene. */
export function LightSeg() {
  const lightSource = useSettings((s) => s.lightSource);
  return (
    <Segmented
      label="Light source for shadows"
      value={lightSource}
      options={LIGHT.map(([value, label, title]) => ({ value, label, title }))}
      onChange={(m) => settingsStore.getState().update({ lightSource: m })}
    />
  );
}
