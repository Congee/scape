import { height } from '@core/format';
import { CoordFormat, formatLngLat } from '@core/geo/coords';
import { settingsStore, useSettings } from '@state/settings';
import { pinSiteHeightM, useTerrain } from '@state/terrain';
import { TerrainKind } from '@workers/terrain.protocol';
import { useWorld } from '@state/world';
import { SKY_TOOLTIP } from '@core/sky/readout';
import { SKYGLOW_PARAMS, skyglowFrom } from '@core/sky/skyglow';
import { GlowStatus, useSkyglow } from '@state/skyglow';
import { PanelTab, uiStore } from '@state/ui';

const NEXT: Record<CoordFormat, CoordFormat> = { dd: CoordFormat.DM, dm: CoordFormat.DMS, dms: CoordFormat.Signed, signed: CoordFormat.DD };

export function Badges() {
  const pin = useWorld((s) => s.pin);
  const format = useSettings((s) => s.coordFormat);
  const units = useSettings((s) => s.units);
  const terrain = useSettings((s) => s.terrain);
  const ground = useTerrain((s) => s.pinGroundM);
  const busy = useTerrain((s) => s.busy[TerrainKind.Elevation]);
  const glow = useSkyglow((s) => s.camera);
  const pinHeightM = useWorld((s) => s.pinHeightM);
  const sky = glow.status === GlowStatus.Ready && glow.bins ? skyglowFrom(glow.bins, pinSiteHeightM({ pinHeightM }, { pinGroundM: ground }), SKYGLOW_PARAMS) : null;
  return (
    <div className="badges">
      <button
        className="badge"
        onClick={() => settingsStore.getState().update({ coordFormat: NEXT[format] })}
        title="Click to cycle the coordinate format"
      >
        {formatLngLat(pin, format)}
      </button>
      {terrain && (
        <span className="badge" title="Ground elevation at the camera location (Terrain Tiles; water shows depth)">
          ▲ {ground == null || Number.isNaN(ground) ? (busy ? '…' : '—') : height(ground, units)}
        </span>
      )}
      {sky && (
        <button className="badge sky-badge" onClick={() => uiStore.getState().setPanelTab(PanelTab.Night)} title={`Sky ≈ ${sky.mag.toFixed(2)} mag/arcsec² at the camera, VIIRS ${glow.year} model. ${SKY_TOOLTIP}`}>
          ✦ Bortle ≈ {sky.bortle.label}
        </button>
      )}
    </div>
  );
}
