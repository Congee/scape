import { compass, degrees, distance, height, type Units } from '@core/format';
import { bearingDeg, destination, distanceM, intermediatePoint } from '@core/geo/geodesy';
import { LosStatus } from '@core/terrain/los';
import { TerrainKind } from '@workers/terrain.protocol';
import { settingsStore, useSettings } from '@state/settings';
import { EYE_HEIGHT_M, profileKeyFor, horizonKeyFor, useTerrain } from '@state/terrain';
import { useWorld, worldStore } from '@state/world';
import type { ProfileResult } from '@workers/terrain.protocol';
import { ProfileChart } from './ProfileChart';
import { useOnMap } from './panelPage';

const signed = (deg: number) => `${deg >= 0 ? '+' : ''}${degrees(deg)}`;

function losText(p: ProfileResult, units: Units): string {
  const l = p.los;
  switch (l.status) {
    case LosStatus.Clear:
      return `Clear · ${height(l.minClearanceM, units)} above the terrain at the tightest point`;
    case LosStatus.Marginal:
      return `Marginal · only ${l.marginDeg.toFixed(2)}° above the terrain`;
    case LosStatus.Blocked:
      return `Blocked · terrain ${distance(l.minClearanceAtM, units)} from the camera stands ${height(-l.minClearanceM, units)} in the way`;
  }
}

export function GeodeticsPanel() {
  const pin = useWorld((s) => s.pin);
  const pin2 = useWorld((s) => s.pin2);
  const pinH = useWorld((s) => s.pinHeightM);
  const pin2H = useWorld((s) => s.pin2HeightM);
  const pin2HAuto = useWorld((s) => s.pin2HeightAuto);
  const pin2HFrom = useWorld((s) => s.pin2HeightFrom);
  const units = useSettings((s) => s.units);
  const terrain = useSettings((s) => s.terrain);
  const profile = useTerrain((s) => s.profile);
  const profileKey = useTerrain((s) => s.profileKey);
  const busy = useTerrain((s) => s.busy[TerrainKind.Profile]);
  const ground = useTerrain((s) => s.pinGroundM);
  const ground2 = useTerrain((s) => s.pin2GroundM);
  const error = useTerrain((s) => s.error);
  const onMap = useOnMap();
  const w = worldStore.getState();

  const place = () => {
    const c = w.view.center;
    w.setPin2(distanceM(pin, c) > 200 ? c : destination(pin, 45, 5000));
  };

  if (!pin2) {
    return (
      <div className="geo">
        <div className="actions">
          <button onClick={place}>Place target</button>
        </div>
        {onMap && <p className="muted hint">or Shift-click the map</p>}
        <HorizonStatus />
      </div>
    );
  }

  const dist = distanceM(pin, pin2);
  const brg = bearingDeg(pin, pin2);
  const fresh = profile && profileKey === profileKeyFor(w, settingsStore.getState()) ? profile : null;
  const groundText = (g: number | null) => (g == null || Number.isNaN(g) ? (terrain ? '…' : 'off') : height(g, units));
  const showBoth = () => {
    const mid = intermediatePoint(pin, pin2, 0.5);
    const zoom = Math.log2((40_075_016 * Math.cos((mid.lat * Math.PI) / 180) * 600) / (256 * Math.max(dist, 50) * 1.4));
    w.flyTo(mid, Math.min(16, Math.max(2, zoom)));
  };

  return (
    <div className="geo">
      <div className="kv">
        <span className="k">Distance</span>
        <b className="v">{distance(dist, units)}</b>
        <span className="k">Bearing</span>
        <b className="v">
          {degrees(brg)} {compass(brg)} <span className="muted">· back {degrees(bearingDeg(pin2, pin))}</span>
        </b>
        <span className="k">Ground, camera</span>
        <b className="v">
          {groundText(ground)} <span className="muted">+ {height(pinH + EYE_HEIGHT_M, units)} camera</span>
        </b>
        <span className="k">Ground, target</span>
        <b className="v">
          {groundText(ground2)}
          <span className="muted"> + </span>
          <input
            type="number"
            min={0}
            max={10000}
            step={1}
            value={pin2H}
            onChange={(e) => w.setPin2Height(Math.max(0, Number(e.target.value) || 0))}
            aria-label="Target height above ground, metres"
          />
          <span className="muted nowrap" title={pin2HAuto ? (pin2HFrom ? 'Apex of the model under the target' : 'Height of the OpenStreetMap building under the target') : undefined}>
            m {pin2HAuto ? (pin2HFrom ? `· from model «${pin2HFrom}»` : '· OSM') : 'target'}
          </span>
        </b>
        <span className="k">Elevation angle</span>
        <b className="v">{fresh ? signed(fresh.los.targetAngleDeg) : terrain ? '…' : 'needs elevation data'}</b>
        <span className="k">Line of sight</span>
        <b className={`v los ${fresh ? fresh.los.status.toLowerCase() : ''}`}>{fresh ? losText(fresh, units) : busy ? 'computing…' : terrain ? '—' : 'needs elevation data'}</b>
      </div>
      {terrain && <ProfileChart />}
      <div className="actions">
        <button onClick={() => w.swapPins()} title="Look the other way">
          Swap camera and target
        </button>
        {onMap && (
          <button onClick={showBoth} title="Fit camera and target on the map">
            Show both
          </button>
        )}
        <button className="link" onClick={() => w.setPin2(null)}>
          Remove target
        </button>
      </div>
      {fresh && fresh.missing > 0 && <p className="muted hint">{fresh.missing} of {fresh.distM.length} profile samples had no elevation data.</p>}
      {error && <p className="error">Terrain data: {error}</p>}
      <HorizonStatus />
    </div>
  );
}

function HorizonStatus() {
  const terrain = useSettings((s) => s.terrain);
  const on = useSettings((s) => s.terrainHorizon);
  const rangeKm = useSettings((s) => s.horizonRangeKm);
  const units = useSettings((s) => s.units);
  const horizon = useTerrain((s) => s.horizon);
  const horizonKey = useTerrain((s) => s.horizonKey);
  const busy = useTerrain((s) => s.busy[TerrainKind.Horizon]);
  const fresh = horizon && horizonKey === horizonKeyFor(worldStore.getState(), settingsStore.getState());
  let text: string;
  if (!terrain) text = 'Elevation data is off (Settings).';
  else if (!on) text = 'Terrain horizon is off (Layers).';
  else if (busy || !fresh) text = `Sweeping the terrain horizon to ${rangeKm} km…`;
  else {
    const peak = horizon.profile.angleDeg.reduce((m, a) => Math.max(m, a), -90);
    text = `Terrain horizon: ${rangeKm} km range, ${horizon.tiles} tiles, camera ${height(horizon.eyeM, units)} above sea level, highest skyline ${signed(peak)}.`;
    if (horizon.missing) text += ` ${horizon.missing} tiles had no data.`;
  }
  return <p className="muted hint">{text}</p>;
}
