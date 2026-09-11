import { formatLngLat, type CoordFormat } from '@core/geo/coords';
import { offsetLabel } from '@core/time/localDay';
import { settingsStore, useSettings } from '@state/settings';
import { useWorld } from '@state/world';

const NEXT: Record<CoordFormat, CoordFormat> = { dd: 'dm', dm: 'dms', dms: 'dd' };

export function Badges() {
  const pin = useWorld((s) => s.pin);
  const tz = useWorld((s) => s.tz);
  const tzAuto = useWorld((s) => s.tzAuto);
  const time = useWorld((s) => s.time);
  const format = useSettings((s) => s.coordFormat);
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
    </div>
  );
}
