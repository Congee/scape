import { fovDeg, frameElevationSpanDeg } from '@core/optics/fov';
import { meshAzPadDeg, meshElPadDeg, MESH_PX_PER_CELL } from '@core/terrain/mesh';
import { clamp } from '@core/viewfinder/palette';
import { requestBuildings, requestLod2, stopBuildings } from '@state/buildings';
import { compositionStore } from '@state/composition';
import { settingsStore } from '@state/settings';
import { viewfinderStore, type ViewWindow } from '@state/viewfinder';
import { worldStore } from '@state/world';
import type { Scene } from './paint';

const D2R = Math.PI / 180;
const MAX_COLUMNS = 2400;
/** Buildings are only worth fetching and drawing this far out. */
export const BUILDING_RANGE_M = 20_000;

const upEighth = (k: number) => Math.ceil(k * 8 - 1e-6) / 8;

/** Asks the terrain worker for a wedge wider than the frame so small pans need no new sweep. */
export function ensureViewWindow(sc: Scene, dpr: number) {
  const s = settingsStore.getState();
  if (!s.terrain) {
    // Buildings stand on the terrain, so they are hidden with it.
    stopBuildings();
    return;
  }
  const wantStep = clamp(sc.hfov / Math.max(100, sc.frame.w), 0.02, 0.5);
  const wantSpan = Math.min(360, Math.max(30, sc.viewHfov * 2 + 10));
  const stepForSpan = Math.max(wantStep, wantSpan / MAX_COLUMNS);
  const rangeM = s.horizonRangeKm * 1000;
  ensureMeshWindow(sc, rangeM, dpr);
  const minStepDeg = Math.max(0.005, sc.vfov / Math.max(100, sc.frame.h) / 2);
  const cur = viewfinderStore.getState().window;
  const needFrom = sc.aim.azimuthDeg - sc.viewHfov / 2 - 5;
  const needTo = sc.aim.azimuthDeg + sc.viewHfov / 2 + 5;
  if (cur && cur.rangeM === rangeM && cur.minStepDeg === minStepDeg && cur.azStepDeg <= stepForSpan * 1.3 && cur.azStepDeg >= stepForSpan / 3) {
    const rel = (a: number) => (((a - cur.azFromDeg) % 360) + 360) % 360;
    const covered = cur.azSpanDeg >= 360 || (rel(needFrom) <= cur.azSpanDeg && rel(needTo) <= cur.azSpanDeg && rel(needFrom) <= rel(needTo));
    if (covered) {
      askBuildings(cur, sc);
      return;
    }
  }
  const win: ViewWindow = {
    // On the step's grid, so the worker keeps the columns a pan still covers.
    azFromDeg: Math.round(((((sc.aim.azimuthDeg - wantSpan / 2) % 360) + 360) % 360) / stepForSpan) * stepForSpan,
    azSpanDeg: wantSpan,
    azStepDeg: stepForSpan,
    rangeM,
    minStepDeg
  };
  viewfinderStore.getState().setWindow(win);
  askBuildings(win, sc);
}

/**
 * Cuts the terrain mesh for the frame. Focal and target land on a quarter-octave ladder and the
 * aim on a grid one pad wide on each axis, so zooming, panning or tilting inside the wedge the
 * last mesh was built for changes nothing and no rebuild is asked for.
 */
function ensureMeshWindow(sc: Scene, rangeM: number, dpr: number) {
  // Cutting the mesh for a placeholder pitch would build the whole thing again once the real one lands.
  if (!sc.aimKnown) return;
  const focalMm = 2 ** (Math.round(Math.log2(sc.cam.focalMm) * 4) / 4);
  // The whole area, in eighths so a resize seldom asks for a new wedge.
  const wMm = sc.cam.frameWmm * upEighth(sc.vp.area.w / sc.vp.frame.w);
  const hMm = sc.cam.frameHmm * upEighth(sc.vp.area.h / sc.vp.frame.h);
  const hfovDeg = fovDeg(wMm, focalMm);
  const pxH = Math.max(100, sc.frame.h * dpr);
  const targetRad = 2 ** (Math.round(Math.log2((MESH_PX_PER_CELL * sc.cam.frameHmm) / (focalMm * pxH)) * 4) / 4);
  const step = meshAzPadDeg(hfovDeg);
  const azimuthDeg = Math.round(sc.aim.azimuthDeg / step) * step;
  const vfovDeg = fovDeg(hMm, focalMm);
  const elStep = meshElPadDeg(vfovDeg);
  const pitchDeg = Math.round(sc.aim.elevationDeg / elStep) * elStep;
  const span = frameElevationSpanDeg(pitchDeg, wMm, hMm, focalMm);
  const elHalfDeg = Math.max(span.maxDeg - pitchDeg, pitchDeg - span.minDeg);
  const cur = viewfinderStore.getState().meshWindow;
  // Frame height sets the wedge as well as the band, so hfov and pitch alone do not pin the mesh.
  if (cur && cur.rangeM === rangeM && cur.hfovDeg === hfovDeg && cur.targetRad === targetRad && cur.azimuthDeg === azimuthDeg && cur.pitchDeg === pitchDeg && cur.elHalfDeg === elHalfDeg && cur.vfovDeg === vfovDeg) return;
  viewfinderStore.getState().setMeshWindow({ rangeM, azimuthDeg, hfovDeg, vfovDeg, pitchDeg, elHalfDeg, targetRad });
}

/** Building volumes for the same wedge the terrain sweep covers, so small pans need no new fetch. */
function askBuildings(win: ViewWindow, sc: Scene) {
  if (!compositionStore.getState().showBuildings) {
    stopBuildings();
    return;
  }
  const pin = worldStore.getState().pin;
  const rangeM = Math.min(win.rangeM, BUILDING_RANGE_M);
  requestBuildings(pin, sc.eyeM, win.azFromDeg, win.azSpanDeg, rangeM);
  // An octave ladder, so zooming only asks again once the tileset's error test could change.
  const pxPerRad = 2 ** Math.round(Math.log2(Math.max(100, sc.frame.w) / (sc.hfov * D2R)));
  requestLod2(pin, sc.eyeM, win.azFromDeg, win.azSpanDeg, rangeM, pxPerRad);
}
