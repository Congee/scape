import type { Observer } from 'astronomy-engine';
import { shallow } from 'zustand/shallow';
import { BODIES, bodyVisible, makeObserver, SkyBody } from '@core/astro/bodies';
import type { PreparedConstellations } from '@core/astro/constellations';
import { activeShowers, radiantEquatorial, type ShowerStatus } from '@core/astro/meteors';
import { apply, applyStar, enuToEqj, eqjToEnu, horizontalOf, poleEnu, refractEnu, starFrame, type StarFrame } from '@core/astro/skyFrame';
import { eqjVector, starRadiusPx, type StarCatalog } from '@core/astro/stars';
import { lunarEclipseLight, shadowView } from '@core/astro/eclipse';
import { lightAt, type Light } from '@core/astro/lightSource';
import { moonView } from '@core/astro/moonSim';
import { moonInfo, moonTerminator, position, semidiameterDeg } from '@core/astro/positions';
import { airDensity } from '@core/astro/refraction';
import { arcWindow, rainbowArc, rainbowRadiusDeg, rainbowTop, WATER_N } from '@core/astro/rainbow';
import { onlyChanged, skyAngleDeg, skyDriftPx } from '@core/drift';
import { distance, height } from '@core/format';
import { bearingDeg, distanceM, elevationAngleDeg, heightAtAngle, type LngLat } from '@core/geo/geodesy';
import { pinFrame } from '@core/geo/pinFrame';
import { anyOccluder, MeshOccluder, type Occluder } from '@core/geo/meshOcclude';
import { placeModel } from '@core/geo/modelPlace';
import { PrismOccluder } from '@core/geo/prismOcclude';
import { prismFrameKey, type PrismShading, type PrismTile } from '@core/geo/prismRaster';
import type { SurfaceMesh } from '@core/geo/surfaces';
import { faceShade, facesToward, solidOf, type Solid } from '@core/geo/solids';
import { effectiveOptics, fovDeg, frameElevationSpanDeg, frameFov, frameMm, tcFactor } from '@core/optics/fov';
import { cameraBasis, discRadiusMm, project, projectDir, unproject, type Camera, type CameraBasis } from '@core/optics/projection';
import { SceneGl, type BodyDisc, type MoonShading } from '@core/viewfinder/gl/sceneGl';
import { labelHitsDiscs, type Disc } from '@core/viewfinder/labelClash';
import { clamp, palette, smooth } from '@core/viewfinder/palette';
import { applyNudge, nudgeForKey, silhouetteEdges } from '@core/model/draw';
import { modelMesh } from '@core/model/mesh';
import { fitPhoto, photoHfovDeg } from '@core/photo/fit';
import { MarkerShape, type SavedMarker } from '@core/plan';
import { flatHorizonDeg } from '@core/terrain/los';
import { meshAzPadDeg, meshElPadDeg, MESH_PX_PER_CELL, type MeshLevel } from '@core/terrain/mesh';
import { columnAt, occluded, type ViewProfile } from '@core/terrain/view';
import { formatTime } from '@core/time/format';
import { buildingsStore, requestBuildings, requestLod2 } from '@state/buildings';
import { lod2Store } from '@state/lod2';
import { aimFor, compositionStore, type Aim } from '@state/composition';
import { dayDataStore } from '@state/dayData';
import { gearStore, sensorById, zoomPatch } from '@state/gear';
import { markersStore } from '@state/markers';
import { modelsStore } from '@state/models';
import { photoStore } from '@state/photo';
import { settingsStore } from '@state/settings';
import { skyStore } from '@state/sky';
import { EYE_HEIGHT_M, meshEyeKeyFor, profileKeyFor, targetAngleFor, terrainStore } from '@state/terrain';
import { viewfinderStore, type ViewWindow } from '@state/viewfinder';
import { worldStore } from '@state/world';
import { MODEL_ACCENT } from '../map/modelOverlay';
import { CATEGORY_COLORS } from '../map/overlays';

const D2R = Math.PI / 180;
const DAY_MS = 86_400_000;
const SIN_10_DEG = Math.sin(10 * D2R);
const LIFT = new Float64Array(3);
const MAX_COLUMNS = 2400;
/** Sun travel that may shift the sky colours and the shading by a step; about 12 s of clock. */
const SUN_STEP_DEG = 0.05;
/** Buildings are only worth fetching and drawing this far out. */
const BUILDING_RANGE_M = 20_000;
const BODY_COLOR: Record<SkyBody, string> = { Sun: '#f5a524', Moon: '#9ccbff', Gc: '#b48cff' };
/** Red to violet; each colour's own index sets its radius, so the secondary comes out reversed. */
const BOW_COLORS = ['#e8453c', '#f59a23', '#f2dc3c', '#4cc35a', '#3a8ee8', '#8a5cd6'];
const BOW_STEPS = 240;
/** Text inside the picture: a dark outline keeps it readable over sun-lit white towers. */
const haloText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number) => {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillText(text, x, y);
};
/** Hex colour multiplied by a flat shade factor. */
const shaded = (hex: string, k: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${((n >> 16) & 255) * k | 0},${((n >> 8) & 255) * k | 0},${(n & 255) * k | 0})`;
};

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  pxPerMm: number;
}

interface Scene {
  cam: Camera;
  basis: CameraBasis;
  aim: Aim;
  /** False while a locked aim has no target elevation yet, so its 0 is a placeholder. */
  aimKnown: boolean;
  frame: Frame;
  hfov: number;
  vfov: number;
  view: ViewProfile | null;
  eyeM: number;
  eyeAboveGroundM: number;
  sunAlt: number;
  sunAz: number;
  /** The body casting shadows, from the light-source setting. */
  light: Light | null;
  time: Date;
  obs: Observer;
  /** Air at the eye relative to sea level; scales refraction. */
  airDensity: number;
  /** How dark the sky is for stars, 0 by day to 1 in astronomical night. */
  night: number;
  /** Moonlight washing out faint stars and the Milky Way, 0..1. */
  moonFactor: number;
  /** Moon's lit fraction times what a lunar eclipse leaves of its light. */
  moonLight: number;
  /** Highest skyline angle in the sweep; directions above it need no occlusion test. */
  maxSkyline: number;
}

interface Placed {
  x: number;
  y: number;
  altDeg: number;
  /** Behind the terrain skyline (or below the flat horizon). */
  hidden: boolean;
}

interface BodyLabel {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
}

interface StarGroup {
  style: string;
  idx: number[];
}

/** Synthetic camera view: terrain layers from the DEM sweep, sky, sun/moon/GC paths, target and markers. */
export class ViewfinderController {
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;
  private unsubs: (() => void)[] = [];
  private raf = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private drag: { x: number; y: number; az: number; el: number } | null = null;
  private starGroups: { cat: StarCatalog; groups: StarGroup[]; polaris: number } | null = null;
  private showers: { day: number; list: ShowerStatus[] } | null = null;
  private skylineMax: { view: ViewProfile | null; max: number } = { view: null, max: -90 };
  /** Eye-relative prisms per tile, only those placed for the current camera location. */
  private prisms = new Map<string, PrismTile>();
  private pathHidden = new Map<SkyBody, { occ: unknown; view: unknown; curve: unknown; h: Int8Array }>();
  private prismSrc: { frame: string; tiles: unknown } | null = null;
  /** Overture rows the LoD2 and model footprints hid, over the tiles drawn. */
  private prismHidden = 0;
  /** One index per LoD2 tile, so a tile streaming in does not re-index the others. */
  private lod2Occ = new WeakMap<SurfaceMesh, MeshOccluder>();
  private prismMs = 0;
  private prismStats = { buildings: 0, tiles: 0 };
  private rasterMs = 0;
  /** The GPU picture pass; null only when it could not start, which `glError` then explains. */
  private sceneGl: SceneGl | null = null;
  private glError = '';
  /** What the live clock is measured against: the last drawn instant, sun and sky scale. */
  private drawn: { time: number; obs: Observer; sunAlt: number; sunAz: number; pxPerDeg: number; halfDiagDeg: number; moving: boolean } | null = null;
  /** Per-object building occlusion for the current frame; the GPU picture cannot mask objects. */
  private occ: Occluder | null = null;
  private occCache: { key: string; occ: Occluder | null } | null = null;
  /** Bumps whenever `prisms` changes, so the prism index is rebuilt only then. */
  private prismRev = 0;
  private meshOccCache: { key: string; occ: MeshOccluder | null } | null = null;
  private anyOccCache: { key: string; occ: Occluder | null } | null = null;
  /** What the overlay hid this frame, for `__scape.overlay`. */
  private seen: { bodies: Record<string, { az: number; alt: number; x: number; y: number; r: number; hidden: boolean }>; markers: Record<string, boolean>; pathLabels: { body: SkyBody; text: string; x: number; y: number; w: number; h: number; skipped: boolean }[] } = { bodies: {}, markers: {}, pathLabels: [] };
  /** Placed models, rebuilt when the camera location or any model changes. */
  private modelCache: { key: string; meshes: SurfaceMesh[]; ids: string[] } | null = null;
  /** The selected model's outline, eye-relative e, n, u pairs. */
  private outlineCache: { key: string; seg: Float32Array } | null = null;
  private gpuMs = -1;

  constructor(private canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement, private photoLayer: HTMLElement | null = null) {
    this.ctx = canvas.getContext('2d')!;
    try {
      this.sceneGl = SceneGl.create(glCanvas);
    } catch (err) {
      this.glError = err instanceof Error ? err.message : String(err);
    }
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    const bump = () => {
      this.ensureWindow();
      this.schedule();
    };
    this.unsubs.push(
      worldStore.subscribe((st, prev) => {
        if (!(st.live && prev.live && onlyChanged(st, prev, 'time'))) bump();
        else if (this.clockMoved()) this.schedule();
      }),
      compositionStore.subscribe(bump),
      gearStore.subscribe(bump),
      settingsStore.subscribe(bump),
      terrainStore.subscribe(() => this.schedule()),
      // The aim elevation comes from the terrain, so new ground or a new profile can move the window.
      terrainStore.subscribe((st) => `${st.pinGroundM}|${st.pin2GroundM}|${st.profileKey}`, bump),
      dayDataStore.subscribe(() => this.schedule()),
      skyStore.subscribe(() => this.schedule()),
      markersStore.subscribe((s) => s.markers, () => this.schedule(), { equalityFn: shallow }),
      buildingsStore.subscribe((s) => s.version, () => this.schedule()),
      lod2Store.subscribe((s) => s.version, () => this.schedule()),
      modelsStore.subscribe((s) => s.rev, () => this.schedule()),
      modelsStore.subscribe((s) => s.selectedId, () => this.schedule()),
      photoStore.subscribe(() => this.schedule())
    );
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDouble);
    canvas.addEventListener('keydown', this.onKey);
    this.ensureWindow();
  }

  /** A live tick redraws once the sky has drifted half a pixel, or the sun far enough to relight it. */
  private clockMoved(): boolean {
    const d = this.drawn;
    if (!d) return true;
    const w = worldStore.getState();
    if (d.moving && skyDriftPx(w.time - d.time, d.pxPerDeg, d.halfDiagDeg) >= 0.5) return true;
    const sun = position(SkyBody.Sun, new Date(w.time), d.obs);
    return skyAngleDeg(d.sunAlt, d.sunAz, sun.altitude, sun.azimuth) >= SUN_STEP_DEG;
  }

  /** Stars, moonlight, a bow or a body near the frame move with the sky; otherwise only the light does. */
  private noteDrawn(sc: Scene) {
    const c = compositionStore.getState();
    const s = settingsStore.getState();
    const fPx = sc.frame.w / (2 * Math.tan((sc.hfov / 2) * D2R));
    const halfDiagDeg = Math.atan(Math.hypot(sc.frame.w, sc.frame.h) / 2 / fPx) / D2R;
    const near = (b: SkyBody) => {
      const p = position(b, sc.time, sc.obs);
      return skyAngleDeg(sc.cam.elevationDeg, sc.cam.azimuthDeg, p.altitude, p.azimuth) < halfDiagDeg + 2;
    };
    const moving = sc.night > 0 || sc.light?.body === SkyBody.Moon || c.showRainbow || BODIES.some((b) => bodyVisible(b, c, s) && near(b));
    this.drawn = { time: sc.time.getTime(), obs: sc.obs, sunAlt: sc.sunAlt, sunAz: sc.sunAz, pxPerDeg: fPx * D2R, halfDiagDeg, moving };
  }

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.sceneGl?.resize(this.canvas.width, this.canvas.height);
    this.ensureWindow();
    // Not a direct draw: sizing the 3D view inside a ResizeObserver callback trips the loop guard.
    this.schedule();
  }

  /** Frame with the sensor's aspect ratio, centred, filling the canvas but for the readout line below. */
  private frameRect(frameWmm: number, frameHmm: number): Frame {
    const availW = Math.max(40, this.w - 16);
    const availH = Math.max(40, this.h - 30);
    const scale = Math.min(availW / frameWmm, availH / frameHmm);
    const w = frameWmm * scale;
    const h = frameHmm * scale;
    return { x: (this.w - w) / 2, y: 8 + (availH - h) / 2, w, h, pxPerMm: scale };
  }

  private scene(): Scene {
    const w = worldStore.getState();
    const c = compositionStore.getState();
    const s = settingsStore.getState();
    const t = terrainStore.getState();
    const sensor = sensorById(c.sensorId, gearStore.getState().cameras);
    const fm = frameMm(sensor, c.orientation);
    const opt = effectiveOptics(c);
    const fov = frameFov(sensor, opt.focalMm, c.orientation);
    const targetAngleDeg = targetAngleFor(w, s, t);
    const aim = aimFor(c, w, targetAngleDeg);
    const cam: Camera = { azimuthDeg: aim.azimuthDeg, elevationDeg: aim.elevationDeg, focalMm: opt.focalMm, frameWmm: fm.w, frameHmm: fm.h };
    const eyeAboveGroundM = w.pinHeightM + EYE_HEIGHT_M;
    // Only a sweep made for this camera position may be drawn; a stale one from elsewhere would lie.
    const here = `${w.pin.lat.toFixed(4)},${w.pin.lng.toFixed(4)}|${eyeAboveGroundM}`;
    const view = s.terrain && t.view && t.viewKey.startsWith(here) ? t.view : null;
    const ground = t.pinGroundM ?? 0;
    const eyeM = view?.eyeM ?? (Number.isNaN(ground) ? 0 : ground) + eyeAboveGroundM;
    const time = new Date(w.time);
    const obs = makeObserver(w.pin, eyeM);
    const sun = position(SkyBody.Sun, time, obs);
    const sunAlt = sun.altitude;
    const moon = position(SkyBody.Moon, time, obs);
    const night = smooth(-4, -14, sunAlt);
    const moonLight = moonInfo(time).illumination * lunarEclipseLight(time);
    const moonFactor = night > 0 ? smooth(-2, 8, moon.altitude) * moonLight : 0;
    const profile = view?.profile ?? null;
    if (this.skylineMax.view !== profile) {
      let max = flatHorizonDeg(eyeAboveGroundM);
      if (profile) for (let i = 0; i < profile.nAz; i++) max = Math.max(max, profile.skylineDeg[i]);
      this.skylineMax = { view: profile, max };
    }
    return { cam, basis: cameraBasis(cam), aim, aimKnown: !aim.locked || targetAngleDeg != null, frame: this.frameRect(fm.w, fm.h), hfov: fov.hDeg, vfov: fov.vDeg, view: profile, eyeM, eyeAboveGroundM, sunAlt, sunAz: sun.azimuth, light: lightAt(s.lightSource, time, obs), time, obs, airDensity: airDensity(eyeM), night, moonFactor, moonLight, maxSkyline: this.skylineMax.max };
  }

  /** Asks the terrain worker for a wedge wider than the frame so small pans need no new sweep. */
  private ensureWindow() {
    const s = settingsStore.getState();
    if (this.w < 40) return;
    const sc = this.scene();
    if (!s.terrain) return;
    const wantStep = clamp(sc.hfov / Math.max(100, sc.frame.w), 0.02, 0.5);
    const wantSpan = Math.min(360, Math.max(30, sc.hfov * 2 + 10));
    const stepForSpan = Math.max(wantStep, wantSpan / MAX_COLUMNS);
    const rangeM = s.horizonRangeKm * 1000;
    this.ensureMeshWindow(sc, rangeM);
    const minStepDeg = Math.max(0.005, sc.vfov / Math.max(100, sc.frame.h) / 2);
    const cur = viewfinderStore.getState().window;
    const needFrom = sc.aim.azimuthDeg - sc.hfov / 2 - 5;
    const needTo = sc.aim.azimuthDeg + sc.hfov / 2 + 5;
    if (cur && cur.rangeM === rangeM && cur.minStepDeg === minStepDeg && cur.azStepDeg <= stepForSpan * 1.3 && cur.azStepDeg >= stepForSpan / 3) {
      const rel = (a: number) => (((a - cur.azFromDeg) % 360) + 360) % 360;
      const covered = cur.azSpanDeg >= 360 || (rel(needFrom) <= cur.azSpanDeg && rel(needTo) <= cur.azSpanDeg && rel(needFrom) <= rel(needTo));
      if (covered) {
        this.askBuildings(cur, sc);
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
    this.askBuildings(win, sc);
  }

  /**
   * Cuts the terrain mesh for the frame. Focal and target land on a quarter-octave ladder and the
   * aim on a grid one pad wide on each axis, so zooming, panning or tilting inside the wedge the
   * last mesh was built for changes nothing and no rebuild is asked for.
   */
  private ensureMeshWindow(sc: Scene, rangeM: number) {
    // Cutting the mesh for a placeholder pitch would build the whole thing again once the real one lands.
    if (!sc.aimKnown) return;
    const focalMm = 2 ** (Math.round(Math.log2(sc.cam.focalMm) * 4) / 4);
    const hfovDeg = fovDeg(sc.cam.frameWmm, focalMm);
    const pxH = Math.max(100, sc.frame.h * this.dpr);
    const targetRad = 2 ** (Math.round(Math.log2((MESH_PX_PER_CELL * sc.cam.frameHmm) / (focalMm * pxH)) * 4) / 4);
    const step = meshAzPadDeg(hfovDeg);
    const azimuthDeg = Math.round(sc.aim.azimuthDeg / step) * step;
    const vfovDeg = fovDeg(sc.cam.frameHmm, focalMm);
    const elStep = meshElPadDeg(vfovDeg);
    const pitchDeg = Math.round(sc.aim.elevationDeg / elStep) * elStep;
    const span = frameElevationSpanDeg(pitchDeg, sc.cam.frameWmm, sc.cam.frameHmm, focalMm);
    const elHalfDeg = Math.max(span.maxDeg - pitchDeg, pitchDeg - span.minDeg);
    const cur = viewfinderStore.getState().meshWindow;
    // Frame height sets the wedge as well as the band, so hfov and pitch alone do not pin the mesh.
    if (cur && cur.rangeM === rangeM && cur.hfovDeg === hfovDeg && cur.targetRad === targetRad && cur.azimuthDeg === azimuthDeg && cur.pitchDeg === pitchDeg && cur.elHalfDeg === elHalfDeg && cur.vfovDeg === vfovDeg) return;
    viewfinderStore.getState().setMeshWindow({ rangeM, azimuthDeg, hfovDeg, vfovDeg, pitchDeg, elHalfDeg, targetRad });
  }

  /** Building volumes for the same wedge the terrain sweep covers, so small pans need no new fetch. */
  private askBuildings(win: ViewWindow, sc: Scene) {
    if (!compositionStore.getState().showBuildings) return;
    const pin = worldStore.getState().pin;
    const rangeM = Math.min(win.rangeM, BUILDING_RANGE_M);
    requestBuildings(pin, sc.eyeM, win.azFromDeg, win.azSpanDeg, rangeM);
    // An octave ladder, so zooming only asks again once the tileset's error test could change.
    const pxPerRad = 2 ** Math.round(Math.log2(Math.max(100, sc.frame.w) / (sc.hfov * D2R)));
    requestLod2(pin, sc.eyeM, win.azFromDeg, win.azSpanDeg, rangeM, pxPerRad);
  }

  private onDown = (e: PointerEvent) => {
    // Otherwise a drag from the canvas selects the toolbar text behind it.
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus();
    const sc = this.scene();
    this.drag = { x: e.clientX, y: e.clientY, az: sc.aim.azimuthDeg, el: sc.aim.elevationDeg };
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const sc = this.scene();
    const degPerPx = sc.hfov / sc.frame.w;
    const az = this.drag.az - (e.clientX - this.drag.x) * degPerPx;
    const el = this.drag.el + (e.clientY - this.drag.y) * degPerPx;
    compositionStore.getState().aim(az, el);
  };

  private onUp = () => {
    this.drag = null;
    this.schedule();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const c = compositionStore.getState();
    const factor = Math.exp(-e.deltaY * 0.0015);
    c.update(zoomPatch(c, c.focalMm * factor));
  };

  private onDouble = (e: MouseEvent) => {
    const sc = this.scene();
    const r = this.canvas.getBoundingClientRect();
    const xMm = (e.clientX - r.left - sc.frame.x - sc.frame.w / 2) / sc.frame.pxPerMm;
    const yMm = (sc.frame.y + sc.frame.h / 2 - (e.clientY - r.top)) / sc.frame.pxPerMm;
    const d = unproject(sc.cam, sc.basis, xMm, yMm);
    compositionStore.getState().aim(d.azimuthDeg, d.altitudeDeg);
  };

  private onKey = (e: KeyboardEvent) => {
    const ms = modelsStore.getState();
    const nudge = ms.adjusting && ms.selectedId ? nudgeForKey(e.key, e.shiftKey, e.altKey) : null;
    const m = nudge && ms.models.find((x) => x.id === ms.selectedId);
    if (nudge && m) {
      void ms.update(m.id, applyNudge(m, nudge, ms.selectedPartId));
      e.preventDefault();
      return;
    }
    const c = compositionStore.getState();
    const sc = this.scene();
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') c.aim(sc.aim.azimuthDeg - step, sc.aim.elevationDeg);
    else if (e.key === 'ArrowRight') c.aim(sc.aim.azimuthDeg + step, sc.aim.elevationDeg);
    else if (e.key === 'ArrowUp') c.aim(sc.aim.azimuthDeg, sc.aim.elevationDeg + step);
    else if (e.key === 'ArrowDown') c.aim(sc.aim.azimuthDeg, sc.aim.elevationDeg - step);
    else if (e.key === '+' || e.key === '=') c.update(zoomPatch(c, c.focalMm * 1.1));
    else if (e.key === '-') c.update(zoomPatch(c, c.focalMm / 1.1));
    else return;
    e.preventDefault();
  };

  private toPx(sc: Scene, azDeg: number, altDeg: number): { x: number; y: number } | null {
    const p = project(sc.cam, sc.basis, azDeg, altDeg);
    if (!p) return null;
    return { x: sc.frame.x + sc.frame.w / 2 + p.x * sc.frame.pxPerMm, y: sc.frame.y + sc.frame.h / 2 - p.y * sc.frame.pxPerMm };
  }

  private inFrame(sc: Scene, p: { x: number; y: number } | null, slack = 0): p is { x: number; y: number } {
    return !!p && p.x >= sc.frame.x - slack && p.x <= sc.frame.x + sc.frame.w + slack && p.y >= sc.frame.y - slack && p.y <= sc.frame.y + sc.frame.h + slack;
  }

  /** Prisms the worker placed for the current camera location; a tile from an old one waits for its rebuild. */
  private prismTiles(sc: Scene): Map<string, PrismTile> {
    const frame = prismFrameKey(worldStore.getState().pin, sc.eyeM);
    const { tiles } = buildingsStore.getState();
    // The store replaces its map on change, so the same identity means nothing new.
    if (this.prismSrc?.frame === frame && this.prismSrc.tiles === tiles) return this.prisms;
    this.prismSrc = { frame, tiles };
    this.prisms = new Map();
    this.prismHidden = 0;
    for (const [k, t] of tiles) {
      if (t.frame !== frame) continue;
      this.prisms.set(k, t.prism);
      this.prismHidden += t.hidden;
    }
    this.prismRev++;
    return this.prisms;
  }

  /** Visible models in the same eye-relative frame as the prisms. */
  private modelSurfaces(sc: Scene): SurfaceMesh[] {
    const w = worldStore.getState();
    const { models, rev } = modelsStore.getState();
    const key = `${w.pin.lat.toFixed(6)},${w.pin.lng.toFixed(6)}|${sc.eyeM.toFixed(2)}|${rev}`;
    if (this.modelCache?.key !== key) {
      const meshes: SurfaceMesh[] = [];
      const ids: string[] = [];
      for (const m of models) {
        const mesh = m.visible ? modelMesh(m) : null;
        if (!mesh || mesh.idx.length === 0) continue;
        meshes.push(placeModel(mesh, m.anchor, m.groundM, w.pin, sc.eyeM));
        ids.push(m.id);
      }
      this.modelCache = { key, meshes, ids };
    }
    return this.modelCache.meshes;
  }

  /** Placed LoD2 meshes; they share the models' pass, index and shadows. */
  private lod2Surfaces(): SurfaceMesh[] {
    return [...lod2Store.getState().tiles.values()].map((t) => t.mesh);
  }

  /** Accent silhouette of the selected model, over the picture; it ignores occluders so a hidden model can still be lined up. */
  private drawModelOutline(sc: Scene) {
    const dev = import.meta.env.DEV ? (window as unknown as { __scape?: Record<string, unknown> }).__scape : undefined;
    const id = modelsStore.getState().selectedId;
    const cache = this.modelCache;
    const shown = compositionStore.getState().showBuildings && settingsStore.getState().terrain;
    const at = shown && id && cache ? cache.ids.indexOf(id) : -1;
    if (!cache || at < 0) {
      if (dev) dev.modelOutline = null;
      return;
    }
    const key = `${cache.key}|${id}`;
    if (this.outlineCache?.key !== key) this.outlineCache = { key, seg: silhouetteEdges(cache.meshes[at].pos, cache.meshes[at].idx) };
    const seg = this.outlineCache.seg;
    const { ctx } = this;
    const F = sc.basis.forward;
    const cx = sc.frame.x + sc.frame.w / 2;
    const cy = sc.frame.y + sc.frame.h / 2;
    const px = (e: number, n: number, u: number) => {
      const p = projectDir(sc.cam, sc.basis, { x: e, y: n, z: u });
      return p && { x: cx + p.x * sc.frame.pxPerMm, y: cy - p.y * sc.frame.pxPerMm };
    };
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    let drawn = 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sc.frame.x, sc.frame.y, sc.frame.w, sc.frame.h);
    ctx.clip();
    ctx.strokeStyle = MODEL_ACCENT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i + 5 < seg.length; i += 6) {
      let [ae, an, au, be, bn, bu] = [seg[i], seg[i + 1], seg[i + 2], seg[i + 3], seg[i + 4], seg[i + 5]];
      const da = ae * F.x + an * F.y + au * F.z;
      const db = be * F.x + bn * F.y + bu * F.z;
      if (da <= 0.1 && db <= 0.1) continue;
      // Clip at a near plane 10 cm ahead so a segment passing beside the eye still draws.
      if (da <= 0.1 || db <= 0.1) {
        const t = (0.1 - da) / (db - da);
        const [ce, cn, cu] = [ae + (be - ae) * t, an + (bn - an) * t, au + (bu - au) * t];
        if (da <= 0.1) [ae, an, au] = [ce, cn, cu];
        else [be, bn, bu] = [ce, cn, cu];
      }
      const p = px(ae, an, au);
      const q = px(be, bn, bu);
      if (!p || !q) continue;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      drawn++;
      box.x0 = Math.min(box.x0, p.x, q.x);
      box.y0 = Math.min(box.y0, p.y, q.y);
      box.x1 = Math.max(box.x1, p.x, q.x);
      box.y1 = Math.max(box.y1, p.y, q.y);
    }
    ctx.stroke();
    ctx.restore();
    if (dev) dev.modelOutline = { id, segments: drawn, box: drawn > 0 ? box : null };
  }

  /** The reference photo's DOM layer, sized to the frame and scaled by its field of view. */
  private placePhoto(sc: Scene) {
    const el = this.photoLayer;
    const img = el?.querySelector('img');
    if (!el || !img) return;
    const p = photoStore.getState();
    el.hidden = !p.url || p.w <= 0;
    const dev = import.meta.env.DEV ? (window as unknown as { __scape?: Record<string, unknown> }).__scape : undefined;
    if (el.hidden || !p.url) {
      if (dev) dev.photo = null;
      return;
    }
    const f = sc.frame;
    const b = fitPhoto(f, sc.cam.focalMm, p);
    if (img.getAttribute('src') !== p.url) img.src = p.url;
    Object.assign(el.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
    Object.assign(img.style, { left: `${b.cx - f.x - b.w / 2}px`, top: `${b.cy - f.y - b.h / 2}px`, width: `${b.w}px`, height: `${b.h}px`, transform: b.rotDeg ? `rotate(${b.rotDeg}deg)` : '', opacity: String(p.opacity) });
    if (dev) dev.photo = { box: b, frame: { x: f.x, y: f.y, w: f.w, h: f.h }, focalMm: sc.cam.focalMm, focal35: p.focal35, hfovDeg: p.focal35 ? photoHfovDeg(p.focal35, p.w, p.h) : sc.hfov, opacity: p.opacity };
  }

  /** Tiles and shading for the GPU prism pass, or null when buildings are off or none have arrived. */
  private glPrisms(sc: Scene, hazeRgb: readonly number[]): { tiles: Iterable<PrismTile>; models: Iterable<SurfaceMesh>; shading: PrismShading } | null {
    this.prismStats = { buildings: 0, tiles: 0 };
    if (!compositionStore.getState().showBuildings || !settingsStore.getState().terrain) return null;
    const tiles = this.prismTiles(sc);
    const models = [...this.modelSurfaces(sc), ...this.lod2Surfaces()];
    if (tiles.size === 0 && models.length === 0) return null;
    this.prismStats = { buildings: 0, tiles: tiles.size };
    const lightAzDeg = sc.light?.azimuthDeg ?? sc.aim.azimuthDeg + 135;
    const rangeM = Math.min(sc.view?.rangeM ?? BUILDING_RANGE_M, BUILDING_RANGE_M);
    return { tiles: [...tiles.values()], models, shading: { lightAzDeg, hazeRgb, night: sc.night, rangeM } };
  }

  /** Index of the same prisms the picture draws; it only changes when the tiles or the camera move. */
  private occluder(sc: Scene): Occluder | null {
    if (!compositionStore.getState().showBuildings || !settingsStore.getState().terrain) return null;
    const tiles = this.prismTiles(sc);
    const models = this.modelSurfaces(sc);
    const lod2 = this.lod2Surfaces();
    if (tiles.size === 0 && models.length === 0 && lod2.length === 0) return null;
    const rangeM = Math.min(sc.view?.rangeM ?? BUILDING_RANGE_M, BUILDING_RANGE_M);
    const key = `${this.prismRev}|${rangeM}`;
    const modelKey = this.modelCache?.key ?? '';
    // Separate caches: tiles streaming in must not re-index a large imported mesh.
    if (this.meshOccCache?.key !== modelKey) this.meshOccCache = { key: modelKey, occ: models.length > 0 ? new MeshOccluder(models) : null };
    if (this.occCache?.key !== key) this.occCache = { key, occ: tiles.size > 0 ? new PrismOccluder(tiles.values(), rangeM) : null };
    const both = `${key}|${modelKey}|${lod2Store.getState().version}`;
    if (this.anyOccCache?.key !== both) {
      const lod2Occ = [...lod2Store.getState().tiles.values()].map((t) => {
        let occ = this.lod2Occ.get(t.mesh);
        if (!occ) this.lod2Occ.set(t.mesh, (occ = new MeshOccluder(t.occ)));
        return occ;
      });
      this.anyOccCache = { key: both, occ: anyOccluder([this.occCache.occ, this.meshOccCache.occ, ...lod2Occ]) };
    }
    return this.anyOccCache.occ;
  }

  private lod2Stats() {
    const l = lod2Store.getState();
    return { tiles: l.tiles.size, tris: l.tris, buildMs: l.buildMs, busy: l.busy, missing: l.missing, error: l.error, hiddenRows: this.prismHidden };
  }

  /** True when a building stands between the eye and a direction; `distM` is Infinity for the sky. */
  private behindBuilding(azDeg: number, altDeg: number, distM: number): boolean {
    if (!this.occ) return false;
    const ca = Math.cos(altDeg * D2R);
    return this.occ.occludes(ca * Math.sin(azDeg * D2R), ca * Math.cos(azDeg * D2R), Math.sin(altDeg * D2R), distM);
  }

  /** Sky, terrain, buildings and shadows on the GPU, into the canvas that sits under this one. */
  private drawSceneGl(sc: Scene, gl: SceneGl) {
    const { frame } = sc;
    const pal = palette(sc.sunAlt);
    const vx = Math.round(frame.x * this.dpr);
    const vw = Math.max(2, Math.round(frame.w * this.dpr));
    const vh = Math.max(2, Math.round(frame.h * this.dpr));
    // GL counts rows from the bottom of the drawing buffer.
    const vy = Math.max(0, this.canvas.height - Math.round(frame.y * this.dpr) - vh);
    const comp = compositionStore.getState();
    const wantMw = comp.showMilkyWay && sc.night > 0;
    if (wantMw) skyStore.getState().ensure();
    const tex = wantMw ? skyStore.getState().milkyWay : null;
    const shadowOn = compositionStore.getState().showSunShadows;
    const t0 = performance.now();
    const stats = gl.render(
      {
        cam: sc.cam,
        basis: sc.basis,
        eyeAboveGroundM: sc.eyeAboveGroundM,
        fallbackDeg: flatHorizonDeg(sc.eyeAboveGroundM),
        day: pal.day,
        dusk: pal.dusk,
        groundNear: pal.groundNear,
        groundFar: pal.groundFar,
        terrain: settingsStore.getState().terrain ? this.meshLevels() : [],
        prism: this.glPrisms(sc, pal.groundFar),
        milkyWay: tex,
        eqj: tex ? enuToEqj(sc.time, sc.obs) : null,
        airDensity: sc.airDensity,
        mwGain: 0.8 * sc.night * (1 - 0.7 * sc.moonFactor),
        lightAzDeg: sc.light?.azimuthDeg ?? sc.sunAz,
        lightAltDeg: sc.light?.altitudeDeg ?? -90,
        // The last degree of light casts a shadow over everything, so fade it out rather than pop at sunset.
        shadowGain: shadowOn && sc.light ? smooth(0, 1.5, sc.light.altitudeDeg) : 0,
        moonlight: sc.light?.body === SkyBody.Moon ? sc.moonLight : 0,
        sunDisc: comp.showSun ? this.bodyDisc(sc, SkyBody.Sun) : null,
        moonDisc: comp.showMoon ? this.bodyDisc(sc, SkyBody.Moon) : null
      },
      vx,
      vy,
      vw,
      vh
    );
    this.rasterMs = performance.now() - t0;
    this.prismMs = -1;
    this.prismStats = { buildings: stats.prism?.buildings ?? 0, tiles: stats.prism?.tiles ?? 0 };
    this.gpuMs = stats.gpuMs;
    if (import.meta.env.DEV) {
      const dev = (window as unknown as { __scape?: Record<string, unknown> }).__scape;
      const shade = { on: stats.cascades > 0, light: sc.light?.body ?? null, cascades: stats.cascades, casterTris: stats.shadowTriangles, casterPrismTris: stats.shadowPrismTriangles, casterModelTris: stats.shadowModelTriangles, rasterMs: this.rasterMs, info: stats.cascadeInfo, viewRangeM: stats.viewRangeM };
      if (dev) dev.prism = { ms: this.prismMs, gpuMs: this.gpuMs, gpuPass: stats.gpuPassMs, ...this.prismStats, models: stats.prism?.models ?? 0, modelTris: stats.prism?.modelTriangles ?? 0, lod2: this.lod2Stats(), terrain: stats.terrain, rw: vw, rh: vh, shadow: shade, cam: { ...sc.cam, eyeM: sc.eyeM, frame: sc.frame, sunAlt: sc.sunAlt, sunAz: sc.sunAz }, behindBuilding: (az: number, alt: number, d: number) => this.behindBuilding(az, alt, d) };
      if (dev) dev.moonDisc = this.moonGeometry(sc);
    }
  }

  /** Mesh levels for this camera position; a set built elsewhere would sit at the wrong height. */
  private meshLevels(): MeshLevel[] {
    const t = terrainStore.getState();
    const eye = meshEyeKeyFor(worldStore.getState(), settingsStore.getState(), viewfinderStore.getState().meshWindow);
    return eye && t.meshKey.startsWith(eye) ? t.mesh.map((m) => m.mesh) : [];
  }

  /** Sun and moon for the picture pass, which clips them against the depth the overlay cannot see. */
  private bodyDisc(sc: Scene, body: SkyBody): BodyDisc | null {
    const pos = position(body, sc.time, sc.obs);
    if (pos.altitude < -2) return null;
    const d = cameraBasis({ azimuthDeg: pos.azimuth, elevationDeg: pos.altitude }).forward;
    const semiDeg = semidiameterDeg(body, sc.time, sc.obs);
    if (body !== SkyBody.Moon) return { dir: [d.x, d.y, d.z], semiDeg, moon: null };
    const mv = moonView(sc.time, sc.obs);
    const map = skyStore.getState().moonMap;
    if (!map) skyStore.getState().ensure();
    return { dir: [d.x, d.y, d.z], semiDeg, moon: { enuToBody: mv.enuToBody, sunDir: mv.sunFromMoonEnu, earthshine: mv.earthshine ? sc.night : 0, map, shadow: this.earthShadow(sc, [d.x, d.y, d.z]) } };
  }

  /** Earth's shadow placed against the drawn, refracted disc: its offset from the geometric moon rides along. */
  private earthShadow(sc: Scene, disc: readonly [number, number, number]): MoonShading['shadow'] {
    const v = shadowView(sc.time, sc.obs);
    if (!v) return null;
    const m = eqjToEnu(sc.time, sc.obs);
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    apply(m, ...v.axis, a);
    apply(m, ...v.moon, b);
    const x = disc[0] + a[0] - b[0];
    const y = disc[1] + a[1] - b[1];
    const z = disc[2] + a[2] - b[2];
    const k = 1 / Math.hypot(x, y, z);
    // The eye adapts to the dimmed disc: its level compresses to the 8th root, detail keeps the cube root.
    return { axis: [x * k, y * k, z * k], umbra: v.umbra, penumbra: v.penumbra, gain: Math.max(lunarEclipseLight(sc.time), 1e-6) ** (1 / 8 - 1 / 3) };
  }

  /** Where the moon disc lands, for the smoke checks. */
  private moonGeometry(sc: Scene) {
    const pos = position(SkyBody.Moon, sc.time, sc.obs);
    const p = this.toPx(sc, pos.azimuth, pos.altitude);
    const mv = moonView(sc.time, sc.obs);
    const r = this.canvas.getBoundingClientRect();
    const radiusPx = discRadiusMm(sc.cam, mv.semidiameterDeg) * sc.frame.pxPerMm;
    const d = cameraBasis({ azimuthDeg: pos.azimuth, elevationDeg: pos.altitude }).forward;
    const sh = this.earthShadow(sc, [d.x, d.y, d.z]);
    const q = sh && this.toPx(sc, (Math.atan2(sh.axis[0], sh.axis[1]) * 180) / Math.PI, (Math.asin(sh.axis[2]) * 180) / Math.PI);
    const px = (rad: number) => discRadiusMm(sc.cam, (rad * 180) / Math.PI) * sc.frame.pxPerMm;
    const shadow = sh && q ? { x: r.left + q.x, y: r.top + q.y, umbraPx: px(sh.umbra), penumbraPx: px(sh.penumbra) } : null;
    return p && { x: r.left + p.x, y: r.top + p.y, radiusPx, illumination: mv.illumination, eclipseLight: lunarEclipseLight(sc.time), shadow, limbFromUpDeg: (((mv.brightLimbPaDeg - mv.parallacticDeg) % 360) + 360) % 360, at: Date.now() };
  }

  private hiddenBySkyline(sc: Scene, azDeg: number, altDeg: number): boolean {
    if (!sc.view) return altDeg < flatHorizonDeg(sc.eyeAboveGroundM);
    const col = columnAt(sc.view, azDeg);
    return col >= 0 && altDeg < sc.view.skylineDeg[col];
  }

  /**
   * Frame position of a local direction. Low directions take the exact path; the rest, refracted,
   * project straight through the camera basis, which is what makes 9k stars cheap.
   */
  private placeEnu(sc: Scene, e: number, n: number, u: number, slack: number): Placed | null {
    const len = Math.hypot(e, n, u);
    const uz = u / len;
    if (uz < -0.05) return null;
    let az = Number.NaN;
    let alt: number;
    let p: { x: number; y: number } | null;
    if (uz < SIN_10_DEG) {
      const h = horizontalOf(e / len, n / len, uz, sc.airDensity);
      az = h.azimuthDeg;
      alt = h.altitudeDeg;
      p = this.toPx(sc, az, alt);
    } else {
      const { forward: F, right: R, up: U } = sc.basis;
      refractEnu(e / len, n / len, uz, LIFT, sc.airDensity);
      const le = LIFT[0];
      const ln = LIFT[1];
      const lu = LIFT[2];
      alt = Math.asin(lu) / D2R;
      const depth = le * F.x + ln * F.y + lu * F.z;
      if (depth <= 1e-6) return null;
      const xs = ((le * R.x + ln * R.y + lu * R.z) / depth) * sc.cam.focalMm;
      const ys = ((le * U.x + ln * U.y + lu * U.z) / depth) * sc.cam.focalMm;
      p = { x: sc.frame.x + sc.frame.w / 2 + xs * sc.frame.pxPerMm, y: sc.frame.y + sc.frame.h / 2 - ys * sc.frame.pxPerMm };
    }
    if (!this.inFrame(sc, p, slack)) return null;
    let hidden = false;
    if (alt < sc.maxSkyline) {
      if (Number.isNaN(az)) az = Math.atan2(e, n) / D2R;
      hidden = this.hiddenBySkyline(sc, az, alt);
    }
    if (!hidden && this.occ) hidden = this.occ.occludes(e, n, u, Infinity);
    return { x: p.x, y: p.y, altDeg: alt, hidden };
  }

  /** Stars bucketed by colour and brightness so the canvas style changes a few dozen times, not 9k. */
  private groupsFor(cat: StarCatalog): { groups: StarGroup[]; polaris: number } {
    if (this.starGroups?.cat === cat) return this.starGroups;
    const map = new Map<string, StarGroup>();
    let polaris = -1;
    for (let i = 0; i < cat.n; i++) {
      const r = cat.rgb[i * 3];
      const g = cat.rgb[i * 3 + 1];
      const b = cat.rgb[i * 3 + 2];
      const m = cat.mag[i];
      const alpha = m <= 1 ? 1 : m <= 2.5 ? 0.88 : m <= 4 ? 0.7 : m <= 5.2 ? 0.5 : 0.36;
      const key = `${r >> 4},${g >> 4},${b >> 4},${alpha}`;
      let grp = map.get(key);
      if (!grp) {
        grp = { style: `rgba(${(r >> 4) * 16 + 8},${(g >> 4) * 16 + 8},${(b >> 4) * 16 + 8},${alpha})`, idx: [] };
        map.set(key, grp);
      }
      grp.idx.push(i);
      if (cat.names.get(i) === 'Polaris') polaris = i;
    }
    this.starGroups = { cat, groups: [...map.values()], polaris };
    return this.starGroups;
  }

  /** Faintest magnitude worth drawing: wider frames and moonlight both hide the faint end. */
  private magLimit(sc: Scene): number {
    return clamp(4.6 + 60 / sc.hfov, 4.5, 6.5) - 1.5 * sc.moonFactor;
  }

  private drawStars(sc: Scene, M: StarFrame, cat: StarCatalog, names: boolean) {
    const { ctx } = this;
    const { groups, polaris } = this.groupsFor(cat);
    const limit = this.magLimit(sc);
    const out = new Float64Array(3);
    const labels: { x: number; y: number; name: string }[] = [];
    ctx.globalAlpha = sc.night;
    for (const g of groups) {
      ctx.fillStyle = g.style;
      for (const i of g.idx) {
        if (cat.mag[i] > limit) break;
        applyStar(M, cat.x[i], cat.y[i], cat.z[i], out);
        const p = this.placeEnu(sc, out[0], out[1], out[2], 4);
        if (!p || p.hidden) continue;
        const r = starRadiusPx(cat.mag[i]);
        if (r < 1.1) ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
        else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (names && (cat.mag[i] <= 1.6 || i === polaris) && cat.names.has(i)) labels.push({ x: p.x, y: p.y, name: cat.names.get(i)! });
      }
    }
    ctx.fillStyle = 'rgba(230,237,243,0.8)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (const l of labels) haloText(ctx, l.name, l.x + 5, l.y - 4);
    ctx.globalAlpha = 1;
  }

  private drawConstellations(sc: Scene, M: StarFrame, pc: PreparedConstellations) {
    const { ctx } = this;
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    const seg = pc.segments;
    ctx.globalAlpha = sc.night;
    ctx.strokeStyle = 'rgba(160,150,230,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let s = 0; s < seg.length; s += 6) {
      applyStar(M, seg[s], seg[s + 1], seg[s + 2], a);
      applyStar(M, seg[s + 3], seg[s + 4], seg[s + 5], b);
      const p = this.placeEnu(sc, a[0], a[1], a[2], 600);
      const q = this.placeEnu(sc, b[0], b[1], b[2], 600);
      if (!p || !q || p.hidden || q.hidden) continue;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    if (sc.hfov > 20) {
      ctx.fillStyle = 'rgba(180,170,240,0.7)';
      ctx.font = 'italic 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < pc.ids.length; i++) {
        applyStar(M, pc.centres[i * 3], pc.centres[i * 3 + 1], pc.centres[i * 3 + 2], a);
        const p = this.placeEnu(sc, a[0], a[1], a[2], 0);
        if (p && !p.hidden) haloText(ctx, pc.names[i], p.x, p.y);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPole(sc: Scene) {
    const [e, n, u] = poleEnu(sc.time, sc.obs);
    const p = this.placeEnu(sc, e, n, u, 0);
    if (!p || p.hidden) return;
    const { ctx } = this;
    ctx.globalAlpha = sc.night;
    ctx.strokeStyle = 'rgba(230,237,243,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.moveTo(p.x - 9, p.y);
    ctx.lineTo(p.x + 9, p.y);
    ctx.moveTo(p.x, p.y - 9);
    ctx.lineTo(p.x, p.y + 9);
    ctx.stroke();
    // Below the mark: Polaris' own label sits above-right, less than a degree away.
    ctx.fillStyle = 'rgba(230,237,243,0.7)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    haloText(ctx, 'Celestial pole', p.x, p.y + 11);
    ctx.globalAlpha = 1;
  }

  /** Trails of the brighter stars over the chosen span, starting at the simulated time. */
  private drawTrails(sc: Scene, cat: StarCatalog) {
    const { ctx } = this;
    const c = compositionStore.getState();
    const steps = clamp(Math.round(c.trailMinutes / 3), 6, 40);
    const dtMs = (c.trailMinutes * 60_000) / steps;
    const mats: StarFrame[] = [];
    for (let k = 0; k <= steps; k++) mats.push(starFrame(new Date(sc.time.getTime() + k * dtMs), sc.obs, mats[0]?.beta));
    const limit = Math.min(4.5, this.magLimit(sc));
    const out = new Float64Array(3);
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.55 * sc.night;
    for (let i = 0; i < cat.n && cat.mag[i] <= limit; i++) {
      ctx.strokeStyle = `rgb(${cat.rgb[i * 3]},${cat.rgb[i * 3 + 1]},${cat.rgb[i * 3 + 2]})`;
      ctx.lineWidth = Math.max(0.7, starRadiusPx(cat.mag[i]) * 0.9);
      ctx.beginPath();
      let started = false;
      for (const m of mats) {
        applyStar(m, cat.x[i], cat.y[i], cat.z[i], out);
        const p = this.placeEnu(sc, out[0], out[1], out[2], 40);
        if (!p || p.hidden) {
          started = false;
          continue;
        }
        if (started) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        started = true;
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  private drawRadiants(sc: Scene, M: StarFrame) {
    const t = sc.time.getTime();
    const day = Math.floor(t / DAY_MS);
    if (!this.showers || this.showers.day !== day) this.showers = { day, list: activeShowers(t) };
    if (this.showers.list.length === 0) return;
    const { ctx } = this;
    const out = new Float64Array(3);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1.2;
    for (const st of this.showers.list) {
      const { raDeg, decDeg } = radiantEquatorial({ ...st, daysFromPeak: (t - st.peakMs) / DAY_MS });
      const [x, y, z] = eqjVector(raDeg, decDeg);
      applyStar(M, x, y, z, out);
      const p = this.placeEnu(sc, out[0], out[1], out[2], 20);
      if (!p) continue;
      ctx.globalAlpha = (p.hidden ? 0.35 : 0.9) * sc.night;
      ctx.strokeStyle = '#ffe08a';
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        ctx.moveTo(p.x + 8 * Math.cos(a), p.y + 8 * Math.sin(a));
        ctx.lineTo(p.x + 13 * Math.cos(a), p.y + 13 * Math.sin(a));
      }
      ctx.stroke();
      haloText(ctx, `${st.shower.name} · ZHR ${st.shower.zhr ?? 'variable'}`, p.x + 16, p.y);
    }
    ctx.globalAlpha = 1;
  }

  /** Stars, constellation figures, the pole, trails and meteor radiants once the sky is dark enough. */
  private drawSky(sc: Scene) {
    const c = compositionStore.getState();
    if (sc.night <= 0 || !(c.showStars || c.showConstellations || c.showTrails || c.showRadiants)) return;
    const sky = skyStore.getState();
    sky.ensure();
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sc.frame.x, sc.frame.y, sc.frame.w, sc.frame.h);
    ctx.clip();
    const M = starFrame(sc.time, sc.obs);
    if (c.showConstellations && sky.constellations) this.drawConstellations(sc, M, sky.constellations);
    if (c.showTrails && sky.stars) this.drawTrails(sc, sky.stars);
    if (c.showStars && sky.stars) this.drawStars(sc, M, sky.stars, c.showStarNames);
    if (c.showStars) this.drawPole(sc);
    if (c.showRadiants) this.drawRadiants(sc, M);
    ctx.restore();
  }

  private drawPath(sc: Scene, body: SkyBody, color: string) {
    const { curve } = dayDataStore.getState();
    if (!curve) return;
    const { ctx } = this;
    const alts = curve.altitude[body];
    const azs = curve.azimuth[body];
    const world = worldStore.getState();
    const hour12 = settingsStore.getState().hour12;
    ctx.lineWidth = 1.5;
    let prev: { x: number; y: number } | null = null;
    let prevHidden = false;
    // The picture draws these under the overlay; ghosted ones behind geometry still show.
    const discs: Disc[] = [SkyBody.Sun, SkyBody.Moon].flatMap((b) => this.seen.bodies[b] ?? []);
    ctx.font = '10px system-ui, sans-serif';
    const pxs = Array.from({ length: curve.n }, (_, i) => this.toPx(sc, azs[i], alts[i]));
    const ins = pxs.map((p) => this.inFrame(sc, p, 40));
    // Occlusion does not depend on the aim, so a drag reuses it until the path or occluders change.
    let memo = this.pathHidden.get(body);
    if (!memo || memo.occ !== this.occ || memo.view !== sc.view || memo.curve !== curve) this.pathHidden.set(body, (memo = { occ: this.occ, view: sc.view, curve, h: new Int8Array(curve.n) }));
    for (let i = 0; i < curve.n; i++) {
      const p = pxs[i];
      const inside = ins[i];
      // Only a drawn neighbouring segment or label reads this point's occlusion.
      const hidden = (inside || !!ins[i - 1] || !!ins[i + 1]) && (memo.h[i] !== 0 ? memo.h[i] > 0 : (memo.h[i] = (!!sc.view && (() => {
        const col = columnAt(sc.view!, azs[i]);
        return col >= 0 && alts[i] < sc.view!.skylineDeg[col];
      })()) || this.behindBuilding(azs[i], alts[i], Infinity) ? 1 : -1) > 0);
      if (p && prev && (inside || this.inFrame(sc, prev, 40))) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = hidden || prevHidden ? 0.35 : 0.9;
        ctx.setLineDash(hidden || prevHidden ? [3, 4] : []);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      const t = curve.startMs + i * curve.stepMs;
      if (inside && p && new Date(t).getUTCMinutes() === 0 && t % 3_600_000 === (curve.startMs % 3_600_000 + (i * curve.stepMs)) % 3_600_000) {
        const label = formatTime(t, world.tz, hour12).replace(':00', '');
        ctx.globalAlpha = hidden ? 0.5 : 0.95;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        const box = { x: p.x + 4, y: p.y - 13, w: ctx.measureText(label).width, h: 10 };
        // Margin is the halo's half stroke.
        const skipped = labelHitsDiscs(box, discs, 1.5);
        this.seen.pathLabels.push({ body, text: label, ...box, skipped });
        if (!skipped) {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          haloText(ctx, label, box.x, p.y - 3);
        }
      }
      prev = p;
      prevHidden = hidden;
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  /** Primary and secondary bows as colour bands; dashed and dim where terrain or a building is in front. */
  private drawRainbow(sc: Scene) {
    const { ctx } = this;
    const minAlt = flatHorizonDeg(sc.eyeAboveGroundM) - 0.5;
    const seen = { clear: 0, dim: 0 };
    for (const [k, alpha] of [[1, 0.8], [2, 0.45]] as const) {
      const mid = rainbowRadiusDeg(WATER_N.Yellow, k);
      if (!rainbowTop(sc.sunAz, sc.sunAlt, mid).possible) continue;
      const width = Math.abs(rainbowRadiusDeg(WATER_N.Red, k) - rainbowRadiusDeg(WATER_N.Violet, k));
      // Sample only what the frame can show, so long lenses keep a smooth arc.
      const range = arcWindow(sc.sunAz, sc.sunAlt, mid, sc.aim.azimuthDeg, sc.aim.elevationDeg, Math.hypot(sc.hfov, sc.vfov) / 2 + width);
      if (!range) continue;
      const centre = rainbowArc(sc.sunAz, sc.sunAlt, mid, -90, BOW_STEPS, range);
      const hidden = centre.map((p) => p.altitudeDeg < minAlt || this.hiddenBySkyline(sc, p.azimuthDeg, p.altitudeDeg) || this.behindBuilding(p.azimuthDeg, p.altitudeDeg, Infinity));
      ctx.lineWidth = Math.max(1.5, (sc.frame.pxPerMm * sc.cam.focalMm * width * D2R) / (BOW_COLORS.length - 1));
      BOW_COLORS.forEach((color, ci) => {
        const n = WATER_N.Red + ((WATER_N.Violet - WATER_N.Red) * ci) / (BOW_COLORS.length - 1);
        const pts = rainbowArc(sc.sunAz, sc.sunAlt, rainbowRadiusDeg(n, k), -90, BOW_STEPS, range);
        ctx.strokeStyle = color;
        let prev: { x: number; y: number } | null = null;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i].altitudeDeg >= minAlt ? this.toPx(sc, pts[i].azimuthDeg, pts[i].altitudeDeg) : null;
          if (p && prev && (this.inFrame(sc, p, 40) || this.inFrame(sc, prev, 40))) {
            const dim = hidden[i] || hidden[i - 1];
            if (this.inFrame(sc, p)) seen[dim ? 'dim' : 'clear']++;
            ctx.globalAlpha = dim ? alpha * 0.35 : alpha;
            ctx.setLineDash(dim ? [3, 4] : []);
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }
          prev = p;
        }
      });
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    if (import.meta.env.DEV) {
      const dev = (window as unknown as { __scape?: Record<string, unknown> }).__scape;
      if (dev) dev.rainbow = { ...seen, at: Date.now() };
    }
  }

  private drawBody(sc: Scene, body: SkyBody, date: Date): BodyLabel | null {
    const pos = position(body, date, sc.obs);
    const p = this.toPx(sc, pos.azimuth, pos.altitude);
    if (!this.inFrame(sc, p, 60)) return null;
    const { ctx } = this;
    const col = sc.view ? columnAt(sc.view, pos.azimuth) : -1;
    const skyline = col >= 0 && sc.view ? sc.view.skylineDeg[col] : flatHorizonDeg(sc.eyeAboveGroundM);
    const semi = semidiameterDeg(body, date, sc.obs);
    const hidden = pos.altitude + semi < skyline || this.behindBuilding(pos.azimuth, pos.altitude, Infinity);
    const r = Math.max(3, discRadiusMm(sc.cam, semi) * sc.frame.pxPerMm);
    this.seen.bodies[body] = { az: pos.azimuth, alt: pos.altitude, x: p.x, y: p.y, r, hidden };
    // The picture pass draws the discs itself, clipped per pixel; only the label is left here.
    const inPicture = !!this.sceneGl && body !== SkyBody.Gc;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sc.frame.x, sc.frame.y, sc.frame.w, sc.frame.h);
    ctx.clip();
    ctx.globalAlpha = hidden ? 0.35 : 1;
    if (body === SkyBody.Gc) {
      ctx.strokeStyle = BODY_COLOR.Gc;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 10, p.y);
      ctx.lineTo(p.x + 10, p.y);
      ctx.moveTo(p.x, p.y - 10);
      ctx.lineTo(p.x, p.y + 10);
      ctx.stroke();
    } else if (inPicture) {
      // Nothing to draw over the picture.
    } else if (body === SkyBody.Sun) {
      const g = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 4);
      g.addColorStop(0, 'rgba(255,220,120,0.55)');
      g.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const info = moonInfo(date);
      ctx.fillStyle = '#2b3442';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      // Lit fraction as a lens shape; the bright limb faces the sun, i.e. west when waxing (northern view).
      const term = moonTerminator(info.illumination, info.waxing);
      ctx.fillStyle = '#e8eef5';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, -Math.PI / 2, Math.PI / 2, term.litSide < 0);
      ctx.ellipse(p.x, p.y, Math.max(0.01, term.rx * r), r, 0, Math.PI / 2, -Math.PI / 2, term.gibbous === (term.litSide < 0));
      ctx.fill();
    }
    ctx.restore();
    return { x: p.x, y: p.y + r + 4, text: body === SkyBody.Gc ? 'Galactic Centre' : body === SkyBody.Sun ? 'Sun' : 'Moon', color: BODY_COLOR[body], alpha: hidden ? 0.35 : 1 };
  }

  /** Body names, drawn over the picture so a tower never swallows a label. */
  private drawBodyLabels(sc: Scene, labels: BodyLabel[]) {
    if (labels.length === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sc.frame.x, sc.frame.y, sc.frame.w, sc.frame.h);
    ctx.clip();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const l of labels) {
      ctx.globalAlpha = l.alpha;
      ctx.fillStyle = l.color;
      haloText(ctx, l.text, l.x, l.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawTarget(sc: Scene) {
    const w = worldStore.getState();
    if (!w.pin2) return;
    const t = terrainStore.getState();
    const s = settingsStore.getState();
    const fresh = t.profile && t.profileKey === profileKeyFor(w, s) ? t.profile : null;
    const az = bearingDeg(w.pin, w.pin2);
    const d = distanceM(w.pin, w.pin2);
    const alt = targetAngleFor(w, s, t);
    if (alt == null) return;
    const p = this.toPx(sc, az, alt);
    if (!this.inFrame(sc, p, 30)) return;
    const { ctx } = this;
    const blocked = fresh?.los.status === 'Blocked';
    ctx.save();
    ctx.beginPath();
    ctx.rect(sc.frame.x, sc.frame.y, sc.frame.w, sc.frame.h);
    ctx.clip();
    ctx.strokeStyle = blocked ? '#ff5c5c' : '#8fd18c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 9);
    ctx.lineTo(p.x + 9, p.y);
    ctx.lineTo(p.x, p.y + 9);
    ctx.lineTo(p.x - 9, p.y);
    ctx.closePath();
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ctx.strokeStyle;
    const label = `Target · ${distance(d, s.units)}${w.pin2HeightM > 0 ? ` · ${height(w.pin2HeightM, s.units)}` : ''}${blocked ? ' · behind terrain' : ''}`;
    const spills = p.x + 13 + ctx.measureText(label).width > sc.frame.x + sc.frame.w;
    ctx.textAlign = spills ? 'right' : 'left';
    haloText(ctx, label, spills ? p.x - 13 : p.x + 13, p.y);
    ctx.restore();
  }

  private drawMarkers(sc: Scene) {
    if (!compositionStore.getState().showMarkers) return;
    const w = worldStore.getState();
    const s = settingsStore.getState();
    const grounds = terrainStore.getState().markerGroundM;
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sc.frame.x, sc.frame.y, sc.frame.w, sc.frame.h);
    ctx.clip();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    // Flat shading follows the picked light (or the sun at dusk), else a fixed key light from the camera's left.
    const sunAz = sc.light?.azimuthDeg ?? (sc.sunAlt > -6 ? sc.sunAz : null);
    const markers: SavedMarker[] = markersStore.getState().markers.filter((m) => m.showInViewfinder);
    for (const m of markers) {
      const d = distanceM(w.pin, m);
      if (d < 5) continue;
      const az = bearingDeg(w.pin, m);
      const g = grounds[m.id];
      const ground = g === undefined || Number.isNaN(g) ? null : g;
      // Without ground data the marker sits on the visible terrain surface at its distance.
      const baseAlt = ground != null ? elevationAngleDeg(d, ground - sc.eyeM) : this.surfaceAngle(sc, az, d);
      if (baseAlt == null) continue;
      const topAlt = ground != null ? elevationAngleDeg(d, ground + m.heightM - sc.eyeM) : baseAlt + (m.heightM / d) / D2R;
      const base = this.toPx(sc, az, baseAlt);
      const top = this.toPx(sc, az, topAlt);
      const halfW = m.widthM > 0 ? (Math.atan(m.widthM / 2 / d) / D2R / sc.hfov) * sc.frame.w : 0;
      if (!base || !top || !(this.inFrame(sc, base, 20 + halfW) || this.inFrame(sc, top, 20 + halfW))) continue;
      const hidden = (!!sc.view && occluded(sc.view, az, topAlt, d)) || this.behindBuilding(az, topAlt, d);
      this.seen.markers[m.id] = hidden;
      const color = CATEGORY_COLORS[m.category];
      ctx.globalAlpha = hidden ? 0.4 : 1;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.5;
      const shape = m.shape ?? MarkerShape.Bar;
      const solid = shape === MarkerShape.Bar ? null : solidOf(shape, { widthM: m.widthM, depthM: m.depthM ?? m.widthM, heightM: m.heightM, rotationDeg: m.rotationDeg ?? 0 });
      if (solid?.faces.length) {
        const groundM = ground ?? heightAtAngle(sc.eyeM, d, baseAlt);
        this.drawSolid(sc, m, solid, d, groundM, color, sunAz ?? bearingDeg(m, w.pin) + 90);
        ctx.fillStyle = color;
      } else if (m.heightM > 0 || halfW > 0) {
        ctx.beginPath();
        ctx.rect(base.x - Math.max(halfW, 1), top.y, Math.max(halfW * 2, 2), Math.max(1, base.y - top.y));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(top.x, top.y - 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(top.x, top.y - 17, 3.5, 0, Math.PI * 2);
      ctx.fill();
      haloText(ctx, `${m.name} · ${distance(d, s.units)}`, top.x, top.y - 22);
    }
    ctx.restore();
  }

  /** Flat-shaded prism for a marker: every footprint vertex placed on the ground, faces painted back to front. */
  private drawSolid(sc: Scene, m: SavedMarker, solid: Solid, distM: number, groundM: number, color: string, lightAzDeg: number) {
    const { ctx } = this;
    const pin = worldStore.getState().pin;
    const toCam = bearingDeg(m, pin) * D2R;
    const eye = { e: distM * Math.sin(toCam), n: distM * Math.cos(toCam), u: sc.eyeM - groundM };
    const local = pinFrame(m);
    const pts = solid.vertices.map((v) => {
      const gp = local.fromEn(v.e, v.n);
      const dv = distanceM(pin, gp);
      if (dv < 1e-6) return null;
      return this.toPx(sc, bearingDeg(pin, gp), elevationAngleDeg(dv, groundM + v.u - sc.eyeM));
    });
    // Vertices projected well past the frame are still drawn; only a wholly off-screen face is dropped.
    const slack = Math.max(sc.frame.w, sc.frame.h) * 2;
    ctx.lineWidth = 1;
    for (const f of facesToward(solid, eye)) {
      const poly = f.v.map((i) => pts[i]);
      if (poly.some((p) => p == null)) continue;
      if (poly.every((p) => !this.inFrame(sc, p, slack))) continue;
      ctx.fillStyle = shaded(color, faceShade(f, lightAzDeg));
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const [i, p] of poly.entries()) {
        if (i === 0) ctx.moveTo(p!.x, p!.y);
        else ctx.lineTo(p!.x, p!.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.lineWidth = 1.5;
  }

  /** Elevation angle of the terrain surface at a distance along an azimuth, from the sweep's visible points. */
  private surfaceAngle(sc: Scene, az: number, d: number): number | null {
    if (!sc.view) return flatHorizonDeg(sc.eyeAboveGroundM);
    const col = columnAt(sc.view, az);
    if (col < 0) return null;
    let best = sc.view.start[col];
    for (let m = sc.view.start[col]; m < sc.view.start[col + 1]; m++) {
      if (sc.view.distM[m] <= d) best = m;
      else break;
    }
    return sc.view.start[col] === sc.view.start[col + 1] ? null : sc.view.angleDeg[best];
  }

  /** One line under the frame: the lens on the left, whatever the view is waiting on to the right. */
  private drawHud(sc: Scene) {
    const { ctx } = this;
    const c = compositionStore.getState();
    const s = settingsStore.getState();
    const t = terrainStore.getState();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const y = sc.frame.y + sc.frame.h + 6;
    const lens = `${effectiveOptics(c).focalMm} mm${c.teleconverters.length === 0 ? '' : ` · ${tcFactor(c.teleconverters)}×`} · ${sc.hfov.toFixed(1)}° × ${sc.vfov.toFixed(1)}°`;
    let status = '';
    if (!s.terrain) status = 'Elevation data is off (Settings): flat horizon';
    else if (t.busy.View) status = 'Sweeping terrain…';
    else if (!sc.view) status = 'Waiting for terrain…';
    else if (c.showBuildings && buildingsStore.getState().busy) status = 'Loading buildings…';
    else if (skyStore.getState().loading) status = 'Loading sky data…';
    else if (skyStore.getState().error) status = `Sky data: ${skyStore.getState().error}`;
    else if (t.view?.missing) status = `${t.view.missing} terrain tiles missing`;
    // Too narrow for both: the status is the one that changes, so it wins.
    const both = !status || ctx.measureText(lens).width + ctx.measureText(status).width + 12 <= sc.frame.w;
    if (both) {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(230,237,243,0.9)';
      ctx.fillText(lens, sc.frame.x, y);
    }
    if (status) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(230,237,243,0.7)';
      ctx.fillText(status, sc.frame.x + sc.frame.w, y);
    }
  }

  /** No GPU, no picture: the frame carries the reason rather than a blank canvas. */
  private drawGlError(sc: Scene) {
    const { ctx } = this;
    const { x, y, w, h } = sc.frame;
    ctx.strokeStyle = 'rgba(230,237,243,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(230,237,243,0.9)';
    const lines: string[] = [];
    for (const word of this.glError.split(' ')) {
      const last = lines.at(-1);
      if (last && ctx.measureText(`${last} ${word}`).width <= w - 24) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    for (const [i, line] of lines.entries()) ctx.fillText(line, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * 18);
  }

  private draw() {
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // The GL canvas underneath holds the picture; over it this one must stay transparent.
    if (this.sceneGl) ctx.clearRect(0, 0, w, h);
    else {
      ctx.fillStyle = '#07090c';
      ctx.fillRect(0, 0, w, h);
    }
    if (w < 40 || h < 40) return;
    const sc = this.scene();
    this.noteDrawn(sc);
    this.placePhoto(sc);
    if (!this.sceneGl) {
      this.drawGlError(sc);
      return;
    }
    const s = settingsStore.getState();
    const c = compositionStore.getState();
    this.occ = this.occluder(sc);
    this.seen = { bodies: {}, markers: {}, pathLabels: [] };
    this.drawSceneGl(sc, this.sceneGl);
    this.drawSky(sc);

    const date = new Date(worldStore.getState().time);
    const labels: BodyLabel[] = [];
    for (const b of BODIES) {
      if (!bodyVisible(b, c, s)) continue;
      const l = this.drawBody(sc, b, date);
      if (l) labels.push(l);
    }
    // Horizon (0°) as a faint dashed line.
    ctx.save();
    ctx.beginPath();
    ctx.rect(sc.frame.x, sc.frame.y, sc.frame.w, sc.frame.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(230,237,243,0.35)';
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 40; i++) {
      const az = sc.aim.azimuthDeg - sc.hfov * 0.75 + (sc.hfov * 1.5 * i) / 40;
      const p = this.toPx(sc, az, 0);
      if (!p) continue;
      if (!started) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      started = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (c.showRainbow) this.drawRainbow(sc);
    if (c.showPaths) {
      for (const b of BODIES) {
        if (!bodyVisible(b, c, s)) continue;
        this.drawPath(sc, b, BODY_COLOR[b]);
      }
    }
    ctx.restore();

    this.drawBodyLabels(sc, labels);
    this.drawMarkers(sc);
    if (import.meta.env.DEV) {
      const dev = (window as unknown as { __scape?: Record<string, unknown> }).__scape;
      if (dev) dev.overlay = { ...this.seen, at: Date.now() };
    }
    this.drawModelOutline(sc);
    this.drawTarget(sc);

    // Frame, thirds grid and centre mark.
    ctx.strokeStyle = 'rgba(230,237,243,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(sc.frame.x) + 0.5, Math.round(sc.frame.y) + 0.5, Math.round(sc.frame.w), Math.round(sc.frame.h));
    if (c.showGrid) {
      ctx.strokeStyle = 'rgba(230,237,243,0.25)';
      for (const f of [1 / 3, 2 / 3]) {
        ctx.beginPath();
        ctx.moveTo(sc.frame.x + sc.frame.w * f, sc.frame.y);
        ctx.lineTo(sc.frame.x + sc.frame.w * f, sc.frame.y + sc.frame.h);
        ctx.moveTo(sc.frame.x, sc.frame.y + sc.frame.h * f);
        ctx.lineTo(sc.frame.x + sc.frame.w, sc.frame.y + sc.frame.h * f);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(230,237,243,0.5)';
    const cx = sc.frame.x + sc.frame.w / 2;
    const cy = sc.frame.y + sc.frame.h / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx, cy + 8);
    ctx.stroke();
    this.drawHud(sc);
  }

  dispose() {
    this.sceneGl?.dispose();
    for (const u of this.unsubs) u();
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('dblclick', this.onDouble);
    this.canvas.removeEventListener('keydown', this.onKey);
  }
}

export type { LngLat };
