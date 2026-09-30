import type { LngLat } from '@core/geo/geodesy';
import { SceneGl } from '@core/viewfinder/gl/sceneGl';
import { keepParked } from '@core/viewfinder/retain';
import { forgetUploads } from '@state/buildings';
import { worldStore } from '@state/world';

/** The GL canvas and its picture pass; `gl` null when it could not start, which `error` then explains. */
export interface GlScene {
  canvas: HTMLCanvasElement;
  gl: SceneGl | null;
  error: string;
}

/** The viewfinder's context kept while it is not shown, so coming back to the same spot re-sends no building. */
let parked: { scene: GlScene & { gl: SceneGl }; at: LngLat; unsub: () => void } | null = null;

/** The parked scene when it still suits the pin, else a fresh one. */
export function takeScene(): GlScene {
  const p = parked;
  if (p && keepParked(p.at, worldStore.getState().pin, p.scene.gl.lost)) {
    p.unsub();
    parked = null;
    return p.scene;
  }
  releaseParked();
  const canvas = document.createElement('canvas');
  canvas.className = 'vf-gl';
  canvas.setAttribute('aria-hidden', 'true');
  try {
    return { canvas, gl: SceneGl.create(canvas), error: '' };
  } catch (err) {
    return { canvas, gl: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Keeps the scene's uploads for the pin's vicinity; the pin leaving it lets them go. */
export function parkScene(scene: GlScene): void {
  scene.canvas.remove();
  const gl = scene.gl;
  if (!gl) return;
  releaseParked();
  gl.park();
  const at = worldStore.getState().pin;
  const unsub = worldStore.subscribe(
    (st) => st.pin,
    (pin) => {
      if (!keepParked(at, pin, gl.lost)) releaseParked();
    }
  );
  parked = { scene: { ...scene, gl }, at, unsub };
}

/** Drops the parked context, and with it every mesh only it held, so the next viewfinder is sent them again. */
export function releaseParked(): void {
  const p = parked;
  if (!p) return;
  parked = null;
  p.unsub();
  p.scene.gl.dispose();
  forgetUploads();
}

/** Dev: where the parked scene sits, or null when none is. */
export function parkedAt(): LngLat | null {
  return parked?.at ?? null;
}
