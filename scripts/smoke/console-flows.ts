// The app's main flows for the console smokes, over any driver: first load, map, terrain, buildings, panels, weather, models, viewfinder, settings.
/* oxlint-disable no-await-in-loop -- flows run one step at a time */

/** What a browser client must do for the flows. */
export interface Driver {
  eval<T = unknown>(expr: string, timeoutMs?: number): Promise<T>;
  navigate(url: string): Promise<void>;
  viewport(w: number, h: number): Promise<void>;
  tap(x: number, y: number): Promise<void>;
  wheel(x: number, y: number, dy: number): Promise<void>;
  drag(x0: number, y0: number, x1: number, y1: number): Promise<void>;
  /** Sets the files of the first element matching `selector`. */
  setFiles(selector: string, paths: string[]): Promise<void>;
}

/** A logged console message, exception or failed request. */
export interface Entry {
  kind: string;
  level: string;
  text: string;
  /** Script or request URL, with line when known. */
  at: string;
}

const HOBOKEN = { lat: 40.7527, lng: -74.0225 };
const TOWER = { lat: 40.754, lng: -74.0008 };
const LAWN = { lat: 40.7536, lng: -73.9837 };
export const Viewports = { Desktop: { w: 1400, h: 900 }, Phone: { w: 390, h: 844 } } as const;

const norm = (s: string) =>
  s
    .replace(/\?[^\s)'"]*/g, '?…')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>')
    .replace(/\d+(\.\d+)?/g, 'N')
    .slice(0, 300);

/** Cuts ids, numbers and query strings, so repeats of one message share a key. */
export function dedupKey(e: Entry): string {
  return `${e.kind}|${e.level}|${norm(e.text)}|${norm(e.at.replace(/:\d+(:\d+)?$/, ''))}`;
}

/** Entries merged by `dedupKey`, with counts and the flow steps that logged them. */
export function dedup(log: (Entry & { step: string })[]): { entry: Entry; count: number; steps: string[] }[] {
  const out = new Map<string, { entry: Entry; count: number; steps: string[] }>();
  for (const e of log) {
    const k = dedupKey(e);
    const hit = out.get(k) ?? { entry: { kind: e.kind, level: e.level, text: e.text, at: e.at }, count: 0, steps: [] };
    hit.count++;
    if (!hit.steps.includes(e.step)) hit.steps.push(e.step);
    out.set(k, hit);
  }
  return [...out.values()];
}

/** Known messages from code we don't own, each with its source; anything else is ours. */
export const THIRD_PARTY: [RegExp, string][] = [
  [/^layers\[(highway-shield-non-us|highway-shield-us-interstate|road_shield_us)\]\.filter/, 'OpenFreeMap Liberty style'],
  [/^Image ".+" could not be loaded\. Please make sure/, 'OpenFreeMap sprite lacks icons its style names'],
  [/\/favicon\.ico$/, "browser, on the smoke's /robots.txt page"]
];
export const sourceOf = (e: Entry) => THIRD_PARTY.find(([re]) => re.test(e.text) || re.test(e.at))?.[1] ?? 'ours';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(d: Driver, expr: string, ms = 30_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await d.eval<boolean>(`!!(${expr})`, 10_000).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

const S = 'window.__scape';
const MAP = 'window.__scapeMap';
const idle = (d: Driver) =>
  d.eval(`new Promise((r) => { const m = ${MAP}; if (!m) return r(0); const t = setTimeout(() => r(0), 20000); m.once('idle', () => (clearTimeout(t), r(1))); m.triggerRepaint(); })`, 30_000).catch(() => 0);
const clickButton = (d: Driver, label: string) =>
  d.eval<boolean>(`(() => { const b = [...document.querySelectorAll('button, a')].find((b) => !b.disabled && (b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.title === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)})); b?.click(); return !!b; })()`);
const run = (d: Driver, body: string, ms = 60_000) => d.eval(`(async () => { const S = ${S}; ${body}; return 1; })()`, ms);
const mapCentre = (d: Driver) => d.eval<{ x: number; y: number; w: number; h: number }>(`(() => { const r = ${MAP}.getCanvas().getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);

/** A JPEG test card drawn in the page, as base64. */
export const PHOTO_JPEG = `(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const g = c.getContext('2d'); g.fillStyle = '#48c'; g.fillRect(0, 0, 600, 400); g.fillStyle = '#fff'; g.fillRect(100, 100, 400, 200); return c.toDataURL('image/jpeg', 0.8).split(',')[1]; })()`;

/**
 * Runs every flow at one viewport, calling `step(name)` before each so the caller can tag what it logs.
 * `files` are local paths: a GLB to import and a JPEG for the reference photo.
 */
export async function flows(d: Driver, base: string, files: { glb: string; photo: string }, step: (name: string) => void): Promise<Record<string, boolean>> {
  const ran: Record<string, boolean> = {};
  step('first load');
  await d.navigate(`${base}/?camera=${HOBOKEN.lat},${HOBOKEN.lng}&target=${TOWER.lat},${TOWER.lng}&z=15`);
  ran.load = await until(d, `${S}?.models?.getState().loaded && ${MAP}?.isStyleLoaded()`, 60_000);
  await idle(d);
  await sleep(3000);

  step('map pan/zoom');
  const c = await mapCentre(d);
  for (let i = 0; i < 6; i++) await d.wheel(c.x, c.y, i < 3 ? -240 : 240);
  await d.drag(c.x, c.y, c.x - c.w / 4, c.y + c.h / 6);
  await run(d, `${MAP}.easeTo({ zoom: 12, duration: 800 }); await new Promise((r) => setTimeout(r, 1200)); ${MAP}.easeTo({ center: [${TOWER.lng}, ${TOWER.lat}], zoom: 16, pitch: 50, bearing: 30, duration: 1200 }); await new Promise((r) => setTimeout(r, 1600))`);
  await idle(d);

  step('terrain off/on');
  await run(d, `S.settings.getState().update({ terrain: false })`);
  await sleep(1500);
  await run(d, `S.settings.getState().update({ terrain: true, terrain3d: true, showHillshade: true })`);
  await sleep(3000);
  await idle(d);
  await run(d, `S.settings.getState().update({ terrain3d: false, showHillshade: false })`);
  await sleep(1500);

  step('buildings');
  await run(d, `S.settings.getState().update({ showBuildings: false })`);
  await sleep(1000);
  await run(d, `S.settings.getState().update({ showBuildings: true }); ${MAP}.jumpTo({ center: [${TOWER.lng}, ${TOWER.lat}], zoom: 17, pitch: 60 })`);
  await sleep(3000);
  await idle(d);

  step('map layers');
  await run(d, `S.settings.getState().update({ showDayNight: true, showElevation: true, showSlope: true, showAspect: true, showLightPollution: true })`);
  await sleep(3000);
  await run(d, `S.settings.getState().update({ showDayNight: false, showElevation: false, showSlope: false, showAspect: false, showLightPollution: false })`);
  await sleep(1000);

  for (const tab of ['Now', 'Shot', 'Sky', 'Find', 'Weather', 'Map', 'Markers']) {
    step(`panel ${tab}`);
    await run(d, `const u = S.ui.getState(); u.setPanelCollapsed(false); u.setPanelTab('${tab}')`);
    await sleep(2000);
  }

  step('weather + alpenglow');
  await run(d, `S.settings.getState().update({ weather: true }); S.ui.getState().setPanelTab('Weather')`);
  await until(d, `document.querySelector('details[data-card=alpenglow] > summary')`, 20_000);
  await sleep(2000);
  await d.eval(`(() => { const d = document.querySelector('details[data-card=alpenglow]'); if (d && !d.open) d.querySelector('summary').click(); return 1; })()`);
  ran.alpenglow = await until(d, `(() => { const g = document.querySelector('[data-glow]'); return g && g.dataset.glow !== 'loading'; })()`, 30_000);
  await sleep(1000);

  step('models draw');
  await run(d, `S.ui.getState().setPanelTab('Markers'); S.ui.getState().setMarkersView('Models')`);
  await sleep(1000);
  const before = await d.eval<number>(`${S}.models.getState().models.length`);
  await clickButton(d, 'Draw a building');
  await until(d, `${S}.models.getState().draft !== null`, 5000);
  await sleep(800);
  await run(d, `${MAP}.jumpTo({ center: [${LAWN.lng}, ${LAWN.lat}], zoom: 17, pitch: 0, bearing: 0 })`);
  await idle(d);
  const r = await d.eval<{ left: number; top: number; width: number; bottom: number }>(
    `(() => { const r = ${MAP}.getCanvas().getBoundingClientRect(), a = document.querySelector('.maplibregl-ctrl-attrib')?.getBoundingClientRect(); return { left: r.left, top: r.top + 70, width: r.width, bottom: Math.min(r.bottom, a?.top ?? r.bottom) - 10 }; })()`
  );
  const cx = r.left + r.width / 2;
  const cy = (r.top + r.bottom) / 2;
  const k = Math.min(60, (r.bottom - r.top) / 2);
  for (const [x, y] of [
    [cx - k, cy - k],
    [cx + k, cy - k],
    [cx + k, cy + k],
    [cx - k, cy + k],
    [cx - k, cy - k]
  ])
    await d.tap(x, y);
  await sleep(1500);
  ran.draw = (await d.eval<number>(`${S}.models.getState().models.length`)) > before;
  if (!ran.draw) await clickButton(d, 'Cancel');

  step('models import');
  await run(d, `S.ui.getState().setPanelTab('Markers'); S.ui.getState().setMarkersView('Models')`);
  await until(d, `document.querySelector('input.model-file')`, 10_000);
  await d.setFiles('input.model-file', [files.glb]);
  await until(d, `document.querySelector('[data-testid="import-stats"], [data-testid="import-error"]')`, 10_000);
  await clickButton(d, 'At map centre');
  await sleep(300);
  const drawn = await d.eval<number>(`${S}.models.getState().models.length`);
  await clickButton(d, 'Place');
  ran.import = await until(d, `${S}.models.getState().models.length > ${drawn}`, 10_000);
  await sleep(2500);

  step('viewfinder open');
  await clickButton(d, 'Viewfinder');
  ran.viewfinder = await until(d, `${S}?.prism?.cam`, 60_000);
  await sleep(3000);

  step('viewfinder sun/moon paths');
  await run(d, `S.composition.getState().update({ showSun: true, showMoon: true, showPaths: true, showStars: true, showMilkyWay: true, showRainbow: true, focalMm: 24 })`);
  const day = await d.eval<number>(`${S}.world.getState().time`);
  for (const h of [-6, 6, 12]) {
    await run(d, `S.world.getState().setTime(${day + h * 3_600_000})`);
    await sleep(1500);
  }
  await run(d, `S.composition.getState().update({ focalMm: 200, orientation: 'Portrait' })`);
  await sleep(2000);

  step('viewfinder photo');
  await until(d, `document.querySelector('input[aria-label="Reference photo file"]')`, 10_000);
  await d.setFiles('input[aria-label="Reference photo file"]', [files.photo]);
  await sleep(2000);
  ran.photo = await clickButton(d, 'Remove the reference photo');
  await run(d, `S.composition.getState().update({ focalMm: 50, orientation: 'Landscape' })`);
  await sleep(1000);

  step('viewfinder close');
  await clickButton(d, 'Map');
  await until(d, `${MAP}?.isStyleLoaded()`, 30_000);
  await sleep(2000);

  step('library');
  await clickButton(d, 'Library');
  await sleep(2000);

  step('settings');
  ran.settings = await clickButton(d, 'Settings');
  await sleep(1500);
  await run(d, `S.settings.getState().update({ units: 'imperial', hour12: false })`);
  await sleep(500);
  await run(d, `S.settings.getState().update({ units: 'metric', hour12: true })`);
  await clickButton(d, 'Map');
  await sleep(2000);

  step('cleanup');
  await run(d, `for (const m of S.models.getState().models.slice(${before})) await S.models.getState().remove(m.id)`);
  return ran;
}

/** Prints the deduplicated log, then one JSON summary line for the shell smoke. */
export function report(log: (Entry & { step: string })[], ran: Record<string, Record<string, boolean>>) {
  const rows = dedup(log);
  for (const r of rows) console.log(`[${r.count}×] ${sourceOf(r.entry)} | ${r.entry.kind} ${r.entry.level}: ${r.entry.text.slice(0, 400)}\n    at ${r.entry.at}\n    steps: ${r.steps.join('; ')}`);
  const ours = rows.filter((r) => sourceOf(r.entry) === 'ours').length;
  console.log(JSON.stringify({ distinct: rows.length, total: log.length, ours, ran }));
  return rows;
}
