import type { Map as MaplibreMap } from 'maplibre-gl';
import type { LngLat } from '@core/geo/geodesy';
import { settingsStore } from '@state/settings';
import { terrainStore } from '@state/terrain';
import { OrbitPivot, uiStore } from '@state/ui';
import { worldStore } from '@state/world';

export const MAX_PITCH = 60;
// Short of 90° so the ground and the lines drawn on it stay in view.
const ORBIT_MAX_PITCH = 80;
const ORBIT_PITCH = 65;
const ORBIT_DEG_PER_S = 6;
const ORBIT_STEP_DEG = 90;

const GESTURES = ['mousedown', 'touchstart', 'wheel'] as const;

function stopSpin() {
  const u = uiStore.getState();
  if (u.orbit !== OrbitPivot.Off && u.orbitSpin) u.setOrbit(u.orbit, false);
}

/** Tilts onto the camera or target and spins about it; any map gesture stops the spin. */
export class Orbit {
  private readonly unsubs: (() => void)[];

  constructor(private readonly map: MaplibreMap) {
    for (const type of GESTURES) map.on(type, stopSpin);
    this.unsubs = [
      () => {
        for (const type of GESTURES) map.off(type, stopSpin);
      },
      uiStore.subscribe((st, prev) => {
        if (st.orbit !== prev.orbit || st.orbitSpin !== prev.orbitSpin) this.apply();
      })
    ];
  }

  private pivot(): LngLat {
    const w = worldStore.getState();
    return uiStore.getState().orbit === OrbitPivot.Target && w.pin2 ? w.pin2 : w.pin;
  }

  private groundM(): number | null {
    const t = terrainStore.getState();
    return uiStore.getState().orbit === OrbitPivot.Target && worldStore.getState().pin2 ? t.pin2GroundM : t.pinGroundM;
  }

  /** Tilts onto the pivot when the orbit starts, then hands over to the spin. */
  private apply() {
    const { orbit } = uiStore.getState();
    if (orbit === OrbitPivot.Off) {
      this.map.stop();
      this.map.setCenterClampedToGround(true);
      this.map.setMaxPitch(MAX_PITCH);
      return;
    }
    const s = settingsStore.getState();
    if (!s.terrain3d) s.update({ terrain3d: true });
    this.map.setMaxPitch(ORBIT_MAX_PITCH);
    const p = this.pivot();
    this.map.setCenterClampedToGround(false);
    this.map.easeTo({ center: [p.lng, p.lat], pitch: Math.max(this.map.getPitch(), ORBIT_PITCH), duration: 800 }, { orbit: true });
  }

  /** Called first on an orbit's moveend: its `jumpTo` fires a nested moveend the controller must see in order. */
  step() {
    const { orbit, orbitSpin } = uiStore.getState();
    if (orbit === OrbitPivot.Off || !orbitSpin || this.map.isMoving()) return;
    const p = this.pivot();
    // The camera turns about the centre's height, which the map's own terrain sample can get far wrong at a summit.
    this.map.jumpTo({ elevation: this.groundM() ?? this.map.queryTerrainElevation([p.lng, p.lat]) ?? 0 });
    this.map.rotateTo(this.map.getBearing() + ORBIT_STEP_DEG, { duration: (ORBIT_STEP_DEG / ORBIT_DEG_PER_S) * 1000, easing: (t) => t, freezeElevation: true }, { orbit: true });
  }

  dispose() {
    for (const u of this.unsubs) u();
  }
}
