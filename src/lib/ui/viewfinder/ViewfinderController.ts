import type { Observer } from 'astronomy-engine';
import { shallow } from 'zustand/shallow';
import { BODIES, bodyVisible, makeObserver, SkyBody } from '@core/astro/bodies';
import { apply, enuToEqj, eqjToEnu } from '@core/astro/skyFrame';
import { lunarEclipseLight, lunarShadowCoverage, shadowView } from '@core/astro/eclipse';
import { lightAt } from '@core/astro/lightSource';
import { moonView } from '@core/astro/moonSim';
import { moonInfo, position, semidiameterDeg } from '@core/astro/positions';
import { airDensity } from '@core/astro/refraction';
import { onlyChanged, skyAngleDeg, skyDriftPx } from '@core/drift';
import { type LngLat } from '@core/geo/geodesy';
import { type Occluder } from '@core/geo/meshOcclude';
import { effectiveOptics, frameFov, frameMm } from '@core/optics/fov';
import { cameraBasis, discRadiusMm, projectDir, unproject, type Camera } from '@core/optics/projection';
import { OverlayBatch } from '@core/viewfinder/gl/overlayGl';
import type { PhotoLayer } from '@core/viewfinder/gl/photoGl';
import type { BodyDisc, MoonShading, SceneGl } from '@core/viewfinder/gl/sceneGl';
import { fitFrame, fitViewports } from '@core/viewfinder/frameFit';
import { behindBuilding, toPx } from '@core/viewfinder/place';
import { starNight } from '@core/viewfinder/skyGate';
import { palette, smooth } from '@core/viewfinder/palette';
import { applyNudge, nudgeForKey, silhouetteEdges, visibleRuns } from '@core/model/draw';
import { fitPhoto, photoHfovDeg } from '@core/photo/fit';
import { flatHorizonDeg } from '@core/terrain/los';
import { type MeshLevel } from '@core/terrain/mesh';
import { occluded, type ViewProfile } from '@core/terrain/view';
import { buildingsStore } from '@state/buildings';
import { lod2Store } from '@state/lod2';
import { aimFor, compositionStore } from '@state/composition';
import { dayDataStore } from '@state/dayData';
import { gearStore, sensorById, zoomPatch } from '@state/gear';
import { markersStore } from '@state/markers';
import { modelsStore } from '@state/models';
import { photoStore } from '@state/photo';
import { settingsStore } from '@state/settings';
import { skyStore } from '@state/sky';
import { EYE_HEIGHT_M, meshEyeKeyFor, targetAngleFor, terrainStore } from '@state/terrain';
import { viewfinderStore } from '@state/viewfinder';
import { worldStore } from '@state/world';
import { MODEL_ACCENT } from '../map/modelOverlay';
import { BuildingLayer } from './buildingLayer';
import { drawBodies, drawBodyLabels, drawPaths, type PathMemo } from './bodies';
import { drawFrame, drawGlError, drawHud } from './hud';
import { drawMarkers, drawTarget } from './markers';
import { type Paint, type Scene, type Seen } from './paint';
import { drawHorizon, drawRainbow, drawSky, type SkyMemo } from './skyMarks';
import { ensureViewWindow } from './viewWindow';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
/** Sun travel that may shift the sky colours and the shading by a step; about 12 s of clock. */
const SUN_STEP_DEG = 0.05;
/** The selected model's outline is tested for occluders about this often along its length. */
const OUTLINE_STEP_PX = 3;
const OUTLINE_MAX_PX = 4000;
/** Occlusion tests per frame for the outline; a dense mesh gets coarser steps. */
const OUTLINE_SAMPLES = 6000;

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
  private readonly skyMemo: SkyMemo = { starGroups: null, showers: null };
  private skylineMax: { view: ViewProfile | null; max: number } = { view: null, max: -90 };
  private readonly pathHidden: PathMemo = new Map();
  private readonly buildings = new BuildingLayer();
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
  /** Sky marks for the picture pass, rebuilt each frame. */
  private readonly marks = new OverlayBatch();
  /** Dev: marks with the exact CPU answer, 6 numbers each, while `__scape.markProbe` is set. */
  private probe: number[] | null = null;
  /** What the overlay hid this frame, for `__scape.overlay`. */
  private seen: Seen = { bodies: {}, markers: {}, pathLabels: [] };
  /** The selected model's outline, eye-relative e, n, u pairs. */
  private outlineCache: { key: string; seg: Float32Array } | null = null;
  private gpuMs = -1;
  /** The reference photo decoded for the picture pass; `image` null while it decodes. */
  private photo: { url: string; image: ImageBitmap | null } | null = null;

  constructor(private canvas: HTMLCanvasElement, sceneGl: SceneGl | null, glError: string) {
    this.ctx = canvas.getContext('2d')!;
    this.sceneGl = sceneGl;
    this.glError = glError;
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
    const halfDiagDeg = Math.atan(Math.hypot(sc.area.w, sc.area.h) / 2 / fPx) / D2R;
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

  /** Frame with the sensor's aspect ratio, centred in the area that fills the canvas but for the readout line below. */
  private frameLayout(frameWmm: number, frameHmm: number, hfov: number, vfov: number) {
    const fit = fitFrame(this.w, this.h, frameWmm, frameHmm);
    const bufferH = this.canvas.height;
    const vp = fitViewports(fit, bufferH, this.dpr);
    const a = vp.area;
    const area = { x: a.x / this.dpr, y: (bufferH - a.y - a.h) / this.dpr, w: a.w / this.dpr, h: a.h / this.dpr };
    const wider = (fovD: number, k: number) => (2 * Math.atan(Math.tan((fovD / 2) * D2R) * k)) / D2R;
    return { frame: fit.frame, area, vp, viewHfov: wider(hfov, a.w / vp.frame.w), viewVfov: wider(vfov, a.h / vp.frame.h) };
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
    const night = starNight(sunAlt);
    const moonLight = moonInfo(time).illumination * lunarEclipseLight(time);
    const moonFactor = night > 0 ? smooth(-2, 8, moon.altitude) * moonLight : 0;
    const profile = view?.profile ?? null;
    if (this.skylineMax.view !== profile) {
      let max = flatHorizonDeg(eyeAboveGroundM);
      if (profile) for (let i = 0; i < profile.nAz; i++) max = Math.max(max, profile.skylineDeg[i]);
      this.skylineMax = { view: profile, max };
    }
    return { cam, basis: cameraBasis(cam), aim, aimKnown: !aim.locked || targetAngleDeg != null, ...this.frameLayout(fm.w, fm.h, fov.hDeg, fov.vDeg), hfov: fov.hDeg, vfov: fov.vDeg, view: profile, eyeM, eyeAboveGroundM, sunAlt, sunAz: sun.azimuth, light: lightAt(s.lightSource, time, obs), time, obs, airDensity: airDensity(eyeM), night, moonFactor, moonLight, maxSkyline: this.skylineMax.max };
  }

  /** Asks the terrain worker for a wedge wider than the frame so small pans need no new sweep. */
  private ensureWindow() {
    if (this.w < 40) return;
    ensureViewWindow(this.scene(), this.dpr);
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

  /** Accent silhouette of the selected model, over the picture; terrain and buildings in front hide it. */
  private drawModelOutline(sc: Scene) {
    const dev = import.meta.env.DEV ? (window as unknown as { __scape?: Record<string, unknown> }).__scape : undefined;
    const id = modelsStore.getState().selectedId;
    const cache = this.buildings.models;
    const shown = compositionStore.getState().showBuildings && settingsStore.getState().terrain;
    const at = shown && id && cache ? cache.ids.indexOf(id) : -1;
    if (!cache || at < 0) {
      if (dev) dev.modelOutline = null;
      return;
    }
    const key = `${cache.key}|${id}`;
    if (this.outlineCache?.key !== key) this.outlineCache = { key, seg: silhouetteEdges(cache.meshes[at].pos, cache.meshes[at].idx) };
    const { ctx } = this;
    const F = sc.basis.forward;
    const cx = sc.frame.x + sc.frame.w / 2;
    const cy = sc.frame.y + sc.frame.h / 2;
    const px = (e: number, n: number, u: number) => {
      const p = projectDir(sc.cam, sc.basis, { x: e, y: n, z: u });
      return p && { x: cx + p.x * sc.frame.pxPerMm, y: cy - p.y * sc.frame.pxPerMm };
    };
    const seg = this.visibleOutline(sc, this.outlineCache.seg, px);
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    let drawn = 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sc.area.x, sc.area.y, sc.area.w, sc.area.h);
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

  /** The outline's pieces not behind terrain or a building, sampled every few pixels within a per-frame budget. */
  private visibleOutline(sc: Scene, seg: Float32Array, px: (e: number, n: number, u: number) => { x: number; y: number } | null): Float32Array {
    const occ = this.occ;
    const view = sc.view;
    if (!occ && !view) return seg;
    const lenPx = new Float32Array(seg.length / 6);
    let total = 0;
    for (let i = 0; i < lenPx.length; i++) {
      const p = px(seg[i * 6], seg[i * 6 + 1], seg[i * 6 + 2]);
      const q = px(seg[i * 6 + 3], seg[i * 6 + 4], seg[i * 6 + 5]);
      lenPx[i] = p && q ? Math.min(Math.hypot(q.x - p.x, q.y - p.y), OUTLINE_MAX_PX) : OUTLINE_MAX_PX / 8;
      total += lenPx[i] / OUTLINE_STEP_PX;
    }
    const scale = Math.min(1, OUTLINE_SAMPLES / Math.max(total, 1));
    return visibleRuns(
      seg,
      (i) => Math.ceil((lenPx[i] / OUTLINE_STEP_PX) * scale),
      (e, n, u) => {
        const h = Math.hypot(e, n);
        const d = Math.hypot(h, u);
        // Short of the point itself, so the model's own faces through it do not count.
        const slack = 0.05 + d * 1e-4;
        return (!!view && occluded(view, Math.atan2(e, n) * R2D, Math.atan2(u, h) * R2D, h - slack)) || (!!occ && occ.occludes(e, n, u, d - slack));
      }
    );
  }

  /** The reference photo for the picture pass, sized to the frame and scaled by its field of view. */
  private photoLayer(sc: Scene): PhotoLayer | null {
    const p = photoStore.getState();
    const dev = import.meta.env.DEV ? (window as unknown as { __scape?: Record<string, unknown> }).__scape : undefined;
    if (!p.url || p.w <= 0 || !this.sceneGl) {
      this.photo?.image?.close();
      this.photo = null;
      if (dev) dev.photo = null;
      return null;
    }
    if (this.photo?.url !== p.url) {
      this.photo?.image?.close();
      this.photo = { url: p.url, image: null };
      void this.decodePhoto(this.photo, p.w, p.h, this.sceneGl.maxTextureSize);
    }
    const f = sc.frame;
    const b = fitPhoto(f, sc.cam.focalMm, p);
    const image = this.photo.image;
    if (dev) dev.photo = { box: b, frame: { x: f.x, y: f.y, w: f.w, h: f.h }, focalMm: sc.cam.focalMm, focal35: p.focal35, fromExif: p.fromExif, hfovDeg: photoHfovDeg(p.focal35, p.w, p.h), opacity: p.opacity, nat: image && { w: image.width, h: image.height } };
    return image && { image, box: b, dpr: this.dpr, opacity: p.opacity };
  }

  /** Decodes with the Exif orientation, as the store measured it, within the texture limit. */
  private async decodePhoto(slot: { url: string; image: ImageBitmap | null }, w: number, h: number, max: number) {
    try {
      const blob = await (await fetch(slot.url)).blob();
      const k = Math.min(1, max / Math.max(w, h));
      const image = await createImageBitmap(blob, { premultiplyAlpha: 'none', ...(k < 1 ? { resizeWidth: Math.floor(w * k), resizeHeight: Math.floor(h * k), resizeQuality: 'high' } : {}) });
      if (this.photo !== slot) return image.close();
      if (Math.abs(image.width / image.height - w / h) > 0.01) throw new Error(`decoded ${image.width}×${image.height}, expected ${w}×${h}`);
      slot.image = image;
      this.schedule();
    } catch (err) {
      if (this.photo === slot) photoStore.setState({ error: `Could not draw the photo: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  /** Sky, terrain, buildings and shadows on the GPU, into the canvas that sits under this one. */
  private drawSceneGl(sc: Scene, gl: SceneGl) {
    const pal = palette(sc.sunAlt);
    const { frame, area } = sc.vp;
    const { x: vx, y: vy, w: vw, h: vh } = area;
    // A sensor as much larger as the area, round the same centre: the frame's own pixels project as before.
    const cam = { ...sc.cam, frameWmm: (sc.cam.frameWmm * vw) / frame.w, frameHmm: (sc.cam.frameHmm * vh) / frame.h };
    const comp = compositionStore.getState();
    const wantMw = comp.showMilkyWay && sc.night > 0;
    if (wantMw) skyStore.getState().ensure();
    const tex = wantMw ? skyStore.getState().milkyWay : null;
    const shadowOn = compositionStore.getState().showSunShadows;
    const t0 = performance.now();
    const stats = gl.render(
      {
        cam,
        shadowCam: sc.cam,
        basis: sc.basis,
        eyeAboveGroundM: sc.eyeAboveGroundM,
        fallbackDeg: flatHorizonDeg(sc.eyeAboveGroundM),
        day: pal.day,
        dusk: pal.dusk,
        groundNear: pal.groundNear,
        groundFar: pal.groundFar,
        terrain: settingsStore.getState().terrain ? this.meshLevels() : [],
        prism: this.buildings.glPrisms(sc, pal.groundFar),
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
        moonDisc: comp.showMoon ? this.bodyDisc(sc, SkyBody.Moon) : null,
        overlay: { batch: this.marks, dpr: this.dpr },
        photo: this.photoLayer(sc)
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
      const shade = { on: stats.cascades > 0, light: sc.light?.body ?? null, cascades: stats.cascades, casterTris: stats.shadowTriangles, casterPrismTris: stats.shadowPrismTriangles, casterModelTris: stats.shadowModelTriangles, rasterMs: this.rasterMs, info: stats.cascadeInfo, fit: stats.shadowFit, viewRangeM: stats.viewRangeM };
      if (dev) dev.prism = { ms: this.prismMs, gpuMs: this.gpuMs, gpuPass: stats.gpuPassMs, ...this.prismStats, models: stats.prism?.models ?? 0, modelTris: stats.prism?.modelTriangles ?? 0, lod2: this.buildings.lod2Stats(), terrain: stats.terrain, rw: vw, rh: vh, shadow: shade, cam: { ...sc.cam, eyeM: sc.eyeM, frame: sc.frame, area: sc.area, sunAlt: sc.sunAlt, sunAz: sc.sunAz }, behindBuilding: (az: number, alt: number, d: number) => behindBuilding(this.occ, az, alt, d) };
      if (dev) dev.moonDisc = this.moonGeometry(sc);
      if (dev) {
        dev.shadowBytes = () => gl.shadowBytes;
        dev.shadowBaseBytes = gl.shadowBaseBytes;
      }
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
    const p = toPx(sc, pos.azimuth, pos.altitude);
    const mv = moonView(sc.time, sc.obs);
    const r = this.canvas.getBoundingClientRect();
    const radiusPx = discRadiusMm(sc.cam, mv.semidiameterDeg) * sc.frame.pxPerMm;
    const d = cameraBasis({ azimuthDeg: pos.azimuth, elevationDeg: pos.altitude }).forward;
    const sh = this.earthShadow(sc, [d.x, d.y, d.z]);
    const q = sh && toPx(sc, (Math.atan2(sh.axis[0], sh.axis[1]) * 180) / Math.PI, (Math.asin(sh.axis[2]) * 180) / Math.PI);
    const px = (rad: number) => discRadiusMm(sc.cam, (rad * 180) / Math.PI) * sc.frame.pxPerMm;
    const shadow = sh && q ? { x: r.left + q.x, y: r.top + q.y, umbraPx: px(sh.umbra), penumbraPx: px(sh.penumbra) } : null;
    return p && { x: r.left + p.x, y: r.top + p.y, radiusPx, illumination: mv.illumination, eclipseLight: lunarEclipseLight(sc.time), umbra: lunarShadowCoverage(sc.time).umbra, shadow, limbFromUpDeg: (((mv.brightLimbPaDeg - mv.parallacticDeg) % 360) + 360) % 360, at: Date.now() };
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
    if (!this.sceneGl) {
      drawGlError(ctx, sc.frame, this.glError);
      return;
    }
    const c = compositionStore.getState();
    this.occ = this.buildings.occluder(sc);
    this.seen = { bodies: {}, markers: {}, pathLabels: [] };
    this.marks.clear();
    this.probe = import.meta.env.DEV && (window as unknown as { __scape?: { markProbe?: boolean } }).__scape?.markProbe ? [] : null;
    const p: Paint = { ctx, marks: this.marks, probe: this.probe, occ: this.occ, seen: this.seen };
    // First in the batch, so every mark draws over them.
    drawHorizon(p, sc);
    if (c.showRainbow) drawRainbow(p, sc);
    drawSky(p, sc, this.skyMemo);

    const labels = drawBodies(p, sc, !!this.sceneGl);
    drawPaths(p, sc, this.pathHidden);
    // After the marks are placed: the picture pass draws them.
    this.drawSceneGl(sc, this.sceneGl);

    drawBodyLabels(p, sc, labels);
    drawMarkers(p, sc);
    if (import.meta.env.DEV) {
      const dev = (window as unknown as { __scape?: Record<string, unknown> }).__scape;
      if (dev) dev.overlay = { ...this.seen, at: Date.now() };
      if (dev) dev.marks = { count: this.marks.count, probe: this.probe };
    }
    this.drawModelOutline(sc);
    drawTarget(p, sc);

    drawFrame(ctx, sc, this.canvas.height, this.dpr);
    drawHud(ctx, sc);
  }

  dispose() {
    this.photo?.image?.close();
    this.photo = null;
    this.buildings.dispose();
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
