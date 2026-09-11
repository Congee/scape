import { height } from '@core/format';
import { formatLngLat, type CoordFormat } from '@core/geo/coords';
import { offsetLabel } from '@core/time/localDay';
import { settingsStore, useSettings } from '@state/settings';
import { useTerrain } from '@state/terrain';
import { useWorld } from '@state/world';

const NEXT: Record<CoordFormat, CoordFormat> = { dd: 'dm', dm: 'dms', dms: 'dd' };

export function Badges() {
  const pin = useWorld((s) => s.pin);
  const tz = useWorld((s) => s.tz);
  const tzAuto = useWorld((s) => s.tzAuto);
  const time = useWorld((s) => s.time);
  const format = useSettings((s) => s.coordFormat);
  const units = useSettings((s) => s.units);
  const terrain = useSettings((s) => s.terrain);
  const ground = useTerrain((s) => s.pinGroundM);
  const busy = useTerrain((s) => s.busy.elevation);
  return (
    <div className="badges">
      <button
        className="badge"
        onClick={() => settingsStore.getState().update({ coordFormat: NEXT[format] })}
        title="Click to cycle the coordinate format"
      >
        {formatLngLat(pin, format)}
      </button>
      <span className="badge" title={tzAuto ? 'Time zone looked up from the pin' : 'Time zone set manually'}>
        {tz} · {offsetLabel(new Date(time), tz)}
        {tzAuto ? '' : ' · manual'}
      </span>
      {terrain && (
        <span className="badge" title="Ground elevation at the pin (Terrain Tiles; water shows depth)">
          ▲ {ground == null || Number.isNaN(ground) ? (busy ? '…' : '—') : height(ground, units)}
        </span>
      )}
    </div>
  );
}
