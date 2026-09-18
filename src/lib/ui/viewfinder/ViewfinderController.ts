import type { Observer } from 'astronomy-engine';
import { shallow } from 'zustand/shallow';
import { BODIES, bodyVisible, makeObserver, SkyBody } from '@core/astro/bodies';
import type { PreparedConstellations } from '@core/astro/constellations';
import { activeShowers, radiantEquatorial, type ShowerStatus } from '@core/astro/meteors';
import { apply, enuToEqj, eqjToEnu, horizontalOf, poleEnu, type Mat3 } from '@core/astro/skyFrame';
import { eqjVector, starRadiusPx, type StarCatalog } from '@core/astro/stars';
import { moonInfo, moonTerminator, position, semidiameterDeg } from '@core/astro/positions';
import { distance, height } from '@core/format';
import { bearingDeg, destination, distanceM, elevationAngleDeg, heightAtAngle, type LngLat } from '@core/geo/geodesy';
import { PrismOccluder } from '@core/geo/prismOcclude';
import { buildPrisms, type PrismShading, type PrismTile } from '@core/geo/prismRaster';
import { faceShade, facesToward, polarOf, solidOf, type Solid } from '@core/geo/solids';
import { effectiveOptics, fovDeg, frameFov, frameMm, tcFactor } from '@core/optics/fov';
import { cameraBasis, discRadiusMm, project, unproject, type Camera, type CameraBasis } from '@core/optics/projection';
import { SceneGl, type BodyDisc } from '@core/viewfinder/gl/sceneGl';
import { clamp, palette, smooth } from '@core/viewfinder/palette';
import { MarkerShape, type SavedMarker } from '@core/plan';
import { flatHorizonDeg } from '@core/terrain/los';
import { meshAzPadDeg, MESH_PX_PER_CELL, type MeshLevel } from '@core/terrain/mesh';
import { columnAt, occluded, type ViewProfile } from '@core/terrain/view';
import { formatTime } from '@core/time/format';
import { buildingsStore, requestBuildings } from '@state/buildings';
import { aimFor, compositionStore, type Aim } from '@state/composition';
import { dayDataStore } from '@state/dayData';
import { gearStore, sensorById, zoomPatch } from '@state/gear';
import { markersStore } from '@state/markers';
import { settingsStore } from '@state/settings';
import { skyStore } from '@state/sky';
import { EYE_HEIGHT_M, meshKeyFor, profileKeyFor, terrainStore } from '@state/terrain';
import { viewfinderStore, type ViewWindow } from '@state/viewfinder';
import { worldStore } from '@state/world';
import { CATEGORY_COLORS } from '../map/overlays';

const D2R = Math.PI / 180;
const DAY_MS = 86_400_000;
const SIN_10_DEG = Math.sin(10 * D2R);
const MAX_COLUMNS = 2400;
/** Buildings are only worth fetching and drawing this far out. */
const BUILDING_RANGE_M = 20_000;
const BODY_COLOR: Record<SkyBody, string> = { Sun: '#f5a524', Moon: '#9ccbff', Gc: '#b48cff' };
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
  frame: Frame;
  hfov: number;
  vfov: number;
  view: ViewProfile | null;
  eyeM: number;
  eyeAboveGroundM: number;
  sunAlt: number;
  sunAz: number;
  time: Date;
  obs: Observer;
  /** How dark the sky is for stars, 0 by day to 1 in astronomical night. */
  night: number;
  /** Moonlight washing out faint stars and the Milky Way, 0..1. */
  moonFactor: number;
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
  /** Eye-relative prisms per tile, rebuilt when the camera location moves. */
  private prisms = new Map<string, PrismTile>();
  private prismKey = '';
  private prismMs = 0;
  private prismStats = { buildings: 0, tiles: 0 };
  private rasterMs = 0;
  /** The GPU picture pass; null only when it could not start, which `glError` then explains. */
  private sceneGl: SceneGl | null = null;
  private glError = '';
  /** Per-object building occlusion for the current frame; the GPU picture cannot mask objects. */
  private occ: PrismOccluder | null = null;
  private occCache: { key: string; occ: PrismOccluder } | null = null;
  private gpuMs = -1;

  constructor(private canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement) {
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
      worldStore.subscribe(bump),
      compositionStore.subscribe(bump),
      gearStore.subscribe(bump),
      settingsStore.subscribe(bump),
      terrainStore.subscribe(() => this.schedule()),
      dayDataStore.subscribe(() => this.schedule()),
      skyStore.subscribe(() => this.schedule()),
      markersStore.subscribe((s) => s.markers, () => this.schedule(), { equalityFn: shallow }),
      buildingsStore.subscribe((s) => s.version, () => this.schedule())
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
    const fresh = t.profile && t.profileKey === profileKeyFor(w, s) ? t.profile : null;
    const aim = aimFor(c, w, fresh?.los.targetAngleDeg ?? null);
    const cam: Camera = { azimuthDeg: aim.azimuthDeg, elevationDeg: aim.elevationDeg, focalMm: opt.focalMm, frameWmm: fm.w, frameHmm: fm.h };
    const eyeAboveGroundM = w.pinHeightM + EYE_HEIGHT_M;
    // Only a sweep made for this camera position may be drawn; a stale one from elsewhere would lie.
    const here = `${w.pin.lat.toFixed(4)},${w.pin.lng.toFixed(4)}|${eyeAboveGroundM}`;
    const view = s.terrain && t.view && t.viewKey.startsWith(here) ? t.view : null;
    const ground = t.pinGroundM ?? 0;
    const eyeM = view?.eyeM ?? Math.max(Number.isNaN(ground) ? 0 : ground, 0) + eyeAboveGroundM;
    const time = new Date(w.time);
    const obs = makeObserver(w.pin, w.pinHeightM);
    const sun = position(SkyBody.Sun, time, obs);
    const sunAlt = sun.altitude;
    const moon = position(SkyBody.Moon, time, obs);
    const night = smooth(-4, -14, sunAlt);
    const moonFactor = night > 0 ? smooth(-2, 8, moon.altitude) * moonInfo(time).illumination : 0;
    const profile = view?.profile ?? null;
    if (this.skylineMax.view !== profile) {
      let max = flatHorizonDeg(eyeAboveGroundM);
      if (profile) for (let i = 0; i < profile.nAz; i++) max = Math.max(max, profile.skylineDeg[i]);
      this.skylineMax = { view: profile, max };
    }
    return { cam, basis: cameraBasis(cam), aim, frame: this.frameRect(fm.w, fm.h), hfov: fov.hDeg, vfov: fov.vDeg, view: profile, eyeM, eyeAboveGroundM, sunAlt, sunAz: sun.azimuth, time, obs, night, moonFactor, maxSkyline: this.skylineMax.max };
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
        this.askBuildings(cur);
        return;
      }
    }
    const win: ViewWindow = {
      azFromDeg: (((sc.aim.azimuthDeg - wantSpan / 2) % 360) + 360) % 360,
      azSpanDeg: wantSpan,
      azStepDeg: stepForSpan,
      rangeM,
      minStepDeg
    };
    viewfinderStore.getState().setWindow(win);
    this.askBuildings(win);
  }

  /**
   * Cuts the terrain mesh for the frame. Focal and target land on a quarter-octave ladder and the
   * aim on a grid one pad wide, so zooming or panning inside the wedge the last mesh was built for
   * changes nothing and no rebuild is asked for.
   */
  private ensureMeshWindow(sc: Scene, rangeM: number) {
    const focalMm = 2 ** (Math.round(Math.log2(sc.cam.focalMm) * 4) / 4);
    const hfovDeg = fovDeg(sc.cam.frameWmm, focalMm);
    const pxH = Math.max(100, sc.frame.h * this.dpr);
    const targetRad = 2 ** (Math.round(Math.log2((MESH_PX_PER_CELL * sc.cam.frameHmm) / (focalMm * pxH)) * 4) / 4);
    const step = meshAzPadDeg(hfovDeg);
    const azimuthDeg = Math.round(sc.aim.azimuthDeg / step) * step;
    const cur = viewfinderStore.getState().meshWindow;
    if (cur && cur.rangeM === rangeM && cur.hfovDeg === hfovDeg && cur.targetRad === targetRad && cur.azimuthDeg === azimuthDeg) return;
    viewfinderStore.getState().setMeshWindow({ rangeM, azimuthDeg, hfovDeg, targetRad });
  }

  /** Building volumes for the same wedge the terrain sweep covers, so small pans need no new fetch. */
  private askBuildings(win: ViewWindow) {
    if (!compositionStore.getState().showBuildings) return;
    requestBuildings(worldStore.getState().pin, win.azFromDeg, win.azSpanDeg, Math.min(win.rangeM, BUILDING_RANGE_M));
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

  /**
   * Prisms for the tiles in the store, in eye-relative metres. The conversion only depends on the
   * camera location, so it survives every pan and zoom until the pin or the eye height moves.
   */
  private prismTiles(sc: Scene): Map<string, PrismTile> {
    const w = worldStore.getState();
    const key = `${w.pin.lat.toFixed(6)},${w.pin.lng.toFixed(6)}|${sc.eyeM.toFixed(2)}`;
    if (key !== this.prismKey) {
      this.prismKey = key;
      this.prisms.clear();
    }
    const { tiles } = buildingsStore.getState();
    for (const k of this.prisms.keys()) if (!tiles.has(k)) this.prisms.delete(k);
    for (const [k, batch] of tiles) if (!this.prisms.has(k)) this.prisms.set(k, buildPrisms(batch, w.pin, sc.eyeM));
    return this.prisms;
  }

  /** Tiles and shading for the GPU prism pass, or null when buildings are off or none have arrived. */
  private glPrisms(sc: Scene, hazeRgb: readonly number[]): { tiles: Iterable<PrismTile>; shading: PrismShading } | null {
    this.prismStats = { buildings: 0, tiles: 0 };
    if (!compositionStore.getState().showBuildings || !settingsStore.getState().terrain) return null;
    const tiles = this.prismTiles(sc);
    if (tiles.size === 0) return null;
    this.prismStats = { buildings: 0, tiles: tiles.size };
    const lightAzDeg = sc.sunAlt > 0 ? sc.sunAz : sc.aim.azimuthDeg + 135;
    const rangeM = Math.min(sc.view?.rangeM ?? BUILDING_RANGE_M, BUILDING_RANGE_M);
    return { tiles: [...tiles.values()], shading: { lightAzDeg, hazeRgb, night: sc.night, rangeM } };
  }

  /** Index of the same prisms the picture draws; it only changes when the tiles or the camera move. */
  private occluder(sc: Scene): PrismOccluder | null {
    if (!compositionStore.getState().showBuildings || !settingsStore.getState().terrain) return null;
    const tiles = this.prismTiles(sc);
    if (tiles.size === 0) return null;
    const rangeM = Math.min(sc.view?.rangeM ?? BUILDING_RANGE_M, BUILDING_RANGE_M);
    const key = `${this.prismKey}|${buildingsStore.getState().version}|${rangeM}`;
    if (this.occCache?.key !== key) this.occCache = { key, occ: new PrismOccluder(tiles.values(), rangeM) };
    return this.occCache.occ;
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
        mwGain: 0.8 * sc.night * (1 - 0.7 * sc.moonFactor),
        sunAzDeg: sc.sunAz,
        sunAltDeg: sc.sunAlt,
        // The last degree of sun casts a shadow over everything, so fade it out rather than pop at sunset.
        shadowGain: shadowOn ? smooth(0, 1.5, sc.sunAlt) : 0,
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
      const shade = { on: stats.cascades > 0, cascades: stats.cascades, casterTris: stats.shadowTriangles, casterPrismTris: stats.shadowPrismTriangles, rasterMs: this.rasterMs, info: stats.cascadeInfo, viewRangeM: stats.viewRangeM };
      if (dev) dev.prism = { ms: this.prismMs, gpuMs: this.gpuMs, ...this.prismStats, terrain: stats.terrain, rw: vw, rh: vh, shadow: shade };
    }
  }

  /** Mesh levels for this camera position; a set built elsewhere would sit at the wrong height. */
  private meshLevels(): MeshLevel[] {
    const t = terrainStore.getState();
    const want = meshKeyFor(worldStore.getState(), settingsStore.getState(), viewfinderStore.getState().meshWindow);
    return want && t.meshKey === want ? t.mesh.map((m) => m.mesh) : [];
  }

  /** Sun and moon for the picture pass, which clips them against the depth the overlay cannot see. */
  private bodyDisc(sc: Scene, body: SkyBody): BodyDisc | null {
    const pos = position(body, sc.time, sc.obs);
    if (pos.altitude < -2) return null;
    const d = cameraBasis({ azimuthDeg: pos.azimuth, elevationDeg: pos.altitude }).forward;
    const semiDeg = semidiameterDeg(body, sc.time, sc.obs);
    if (body !== SkyBody.Moon) return { dir: [d.x, d.y, d.z], semiDeg, moon: null };
    const info = moonInfo(sc.time);
    return { dir: [d.x, d.y, d.z], semiDeg, moon: moonTerminator(info.illumination, info.waxing) };
  }

  private hiddenBySkyline(sc: Scene, azDeg: number, altDeg: number): boolean {
    if (!sc.view) return altDeg < flatHorizonDeg(sc.eyeAboveGroundM);
    const col = columnAt(sc.view, azDeg);
    return col >= 0 && altDeg < sc.view.skylineDeg[col];
  }

  /**
   * Frame position of a local direction. Low directions take the exact path with refraction;
   * the rest project straight through the camera basis, which is what makes 9k stars cheap.
   */
  private placeEnu(sc: Scene, e: number, n: number, u: number, slack: number): Placed | null {
    const len = Math.hypot(e, n, u);
    const uz = u / len;
    if (uz < -0.05) return null;
    let az = Number.NaN;
    let alt: number;
    let p: { x: number; y: number } | null;
    if (uz < SIN_10_DEG) {
      const h = horizontalOf(e / len, n / len, uz);
      az = h.azimuthDeg;
      alt = h.altitudeDeg;
      p = this.toPx(sc, az, alt);
    } else {
      const { forward: F, right: R, up: U } = sc.basis;
      const depth = (e * F.x + n * F.y + u * F.z) / len;
      if (depth <= 1e-6) return null;
      const xs = ((e * R.x + n * R.y + u * R.z) / len / depth) * sc.cam.focalMm;
      const ys = ((e * U.x + n * U.y + u * U.z) / len / depth) * sc.cam.focalMm;
      p = { x: sc.frame.x + sc.frame.w / 2 + xs * sc.frame.pxPerMm, y: sc.frame.y + sc.frame.h / 2 - ys * sc.frame.pxPerMm };
      alt = Math.asin(uz) / D2R;
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

  private drawStars(sc: Scene, M: Mat3, cat: StarCatalog, names: boolean) {
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
        apply(M, cat.x[i], cat.y[i], cat.z[i], out);
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

  private drawConstellations(sc: Scene, M: Mat3, pc: PreparedConstellations) {
    const { ctx } = this;
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    const seg = pc.segments;
    ctx.globalAlpha = sc.night;
    ctx.strokeStyle = 'rgba(160,150,230,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let s = 0; s < seg.length; s += 6) {
      apply(M, seg[s], seg[s + 1], seg[s + 2], a);
      apply(M, seg[s + 3], seg[s + 4], seg[s + 5], b);
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
        apply(M, pc.centres[i * 3], pc.centres[i * 3 + 1], pc.centres[i * 3 + 2], a);
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
    const mats: Mat3[] = [];
    for (let k = 0; k <= steps; k++) mats.push(eqjToEnu(new Date(sc.time.getTime() + k * dtMs), sc.obs));
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
        apply(m, cat.x[i], cat.y[i], cat.z[i], out);
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

  private drawRadiants(sc: Scene, M: Mat3) {
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
      apply(M, x, y, z, out);
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
    const M = eqjToEnu(sc.time, sc.obs);
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
    for (let i = 0; i < curve.n; i++) {
      const p = this.toPx(sc, azs[i], alts[i]);
      const inside = this.inFrame(sc, p, 40);
      const hidden = (!!sc.view && (() => {
        const col = columnAt(sc.view!, azs[i]);
        return col >= 0 && alts[i] < sc.view!.skylineDeg[col];
      })()) || this.behindBuilding(azs[i], alts[i], Infinity);
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
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        haloText(ctx, label, p.x + 4, p.y - 3);
      }
      prev = p;
      prevHidden = hidden;
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  private drawBody(sc: Scene, body: SkyBody, date: Date): BodyLabel | null {
    const w = worldStore.getState();
    const pos = position(body, date, makeObserver(w.pin, w.pinHeightM));
    const p = this.toPx(sc, pos.azimuth, pos.altitude);
    if (!this.inFrame(sc, p, 60)) return null;
    const { ctx } = this;
    const col = sc.view ? columnAt(sc.view, pos.azimuth) : -1;
    const skyline = col >= 0 && sc.view ? sc.view.skylineDeg[col] : flatHorizonDeg(sc.eyeAboveGroundM);
    const semi = semidiameterDeg(body, date, sc.obs);
    const hidden = pos.altitude + semi < skyline || this.behindBuilding(pos.azimuth, pos.altitude, Infinity);
    const r = Math.max(3, discRadiusMm(sc.cam, semi) * sc.frame.pxPerMm);
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
    const ground2 = t.pin2GroundM;
    const alt = fresh ? fresh.los.targetAngleDeg : elevationAngleDeg(d, Math.max(ground2 ?? 0, 0) + w.pin2HeightM - sc.eyeM);
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
    // Flat shading follows the sun by day and a fixed key light from the camera's left at night.
    const sunAz = sc.sunAlt > -6 ? sc.sunAz : null;
    const markers: SavedMarker[] = markersStore.getState().markers.filter((m) => m.showInViewfinder);
    for (const m of markers) {
      const d = distanceM(w.pin, m);
      if (d < 5) continue;
      const az = bearingDeg(w.pin, m);
      const g = grounds[m.id];
      const ground = g === undefined || Number.isNaN(g) ? null : Math.max(g, 0);
      // Without ground data the marker sits on the visible terrain surface at its distance.
      const baseAlt = ground != null ? elevationAngleDeg(d, ground - sc.eyeM) : this.surfaceAngle(sc, az, d);
      if (baseAlt == null) continue;
      const topAlt = ground != null ? elevationAngleDeg(d, ground + m.heightM - sc.eyeM) : baseAlt + (m.heightM / d) / D2R;
      const base = this.toPx(sc, az, baseAlt);
      const top = this.toPx(sc, az, topAlt);
      const halfW = m.widthM > 0 ? (Math.atan(m.widthM / 2 / d) / D2R / sc.hfov) * sc.frame.w : 0;
      if (!base || !top || !(this.inFrame(sc, base, 20 + halfW) || this.inFrame(sc, top, 20 + halfW))) continue;
      const hidden = (!!sc.view && occluded(sc.view, az, topAlt, d)) || this.behindBuilding(az, topAlt, d);
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
    const pts = solid.vertices.map((v) => {
      const pol = polarOf(v);
      const gp = pol.distM > 1e-6 ? destination(m, pol.bearingDeg, pol.distM) : m;
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
    if (!this.sceneGl) {
      this.drawGlError(sc);
      return;
    }
    const s = settingsStore.getState();
    const c = compositionStore.getState();
    this.occ = this.occluder(sc);
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
    if (c.showPaths) {
      for (const b of BODIES) {
        if (!bodyVisible(b, c, s)) continue;
        this.drawPath(sc, b, BODY_COLOR[b]);
      }
    }
    ctx.restore();

    this.drawBodyLabels(sc, labels);
    this.drawMarkers(sc);
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
