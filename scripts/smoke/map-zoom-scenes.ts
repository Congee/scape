// Scenes, layer sets and injected stutter shared by the Chromium and Firefox zoom smokes.
const DAY = '2026-06-21T13:00Z';
export const Scenes: Record<string, { at: string; z: number; pitch?: number; bearing?: number; target?: string }> = {
  // Across the Hudson from Hoboken at the Midtown skyline, where the lag was felt.
  hoboken: { at: '40.7450,-74.0300', z: 15.5, pitch: 60, bearing: 90 },
  rotterdam: { at: '51.9091,4.4868', z: 15.5 },
  manhattan: { at: '40.7549,-73.9840', z: 15.5 },
  zermatt: { at: '45.9900,7.7200', z: 12.5 },
  plain: { at: '38.5000,-98.5000', z: 12 },
  // Where the user recorded their Firefox traces: pin and target set, looking down.
  user: { at: '40.74878,-74.02279', target: '40.75367,-74.00003', z: 13.3 }
};
// Settings patches over the defaults (buildings, sun shadows, event and live lines on; hillshade and 3D terrain off).
export const Layers: Record<string, Record<string, boolean>> = {
  default: {},
  bare: { showBuildings: false, showSunShadows: false, showEventLines: false, showLiveLines: false },
  nobuildings: { showBuildings: false },
  noshadow: { showSunShadows: false },
  nolines: { showEventLines: false, showLiveLines: false },
  hillshade: { showHillshade: true },
  terrain3d: { terrain3d: true }
};
export const DEFAULTS = { terrain: true, showBuildings: true, showSunShadows: true, showEventLines: true, showLiveLines: true, showHillshade: false, terrain3d: false };
export const Injects: Record<string, object> = { block: { blockMs: 30, everyMs: 300 }, ease: { ease: true } };


export const sceneUrl = (origin: string, s: (typeof Scenes)[string]) => `${origin}/?zoomprobe&camera=${s.at}${s.target ? `&target=${s.target}` : ''}&t=${DAY}&z=${s.z}`;
