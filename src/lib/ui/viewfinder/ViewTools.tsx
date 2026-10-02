import { useNavigate } from '@tanstack/react-router';
import { LightMode } from '@core/astro/lightSource';
import { degrees, distance } from '@core/format';
import { bearingDeg, distanceM } from '@core/geo/geodesy';
import { LosStatus } from '@core/terrain/los';
import { BUILDINGS_ATTRIBUTION } from '@data/buildingTiles';
import { GEOID_DOWNLOAD_URL, geoidCredit } from '@data/geoid';
import { compositionStore, useComposition, type Composition } from '@state/composition';
import { lod2Drawn, lod2GeoidUse, useLod2 } from '@state/lod2';
import { useOffline } from '@state/offline';
import { settingsStore, useSettings } from '@state/settings';
import { profileKeyFor, useTerrain } from '@state/terrain';
import { PanelPage, PanelTab, uiStore } from '@state/ui';
import { useWorld, worldStore } from '@state/world';
import { useShallow } from 'zustand/react/shallow';
import { Dial } from '../Dial';
import { useSavedName } from '../PlanHeader';
import { FormRow, Section } from '../Section';
import { PhotoTools } from './PhotoTools';

type BoolKey = { [K in keyof Composition]: Composition[K] extends boolean ? K : never }[keyof Composition];
type Chip = [BoolKey, string, string];

const BODIES: Chip[] = [
  ['showSun', 'Sun', 'The sun disc, its label and its path'],
  ['showMoon', 'Moon', 'The moon disc, its label and its path'],
  ['showMilkyWay', 'Milky Way', 'NASA Milky Way map'],
  ['showPaths', 'Paths', 'Sun, moon and Galactic Centre paths for the day'],
  ['showRainbow', 'Rainbow', 'Where a rainbow would stand: the 42° and 51° arcs opposite the sun']
];
const NIGHT: Chip[] = [
  ['showStars', 'Stars', 'Star field (HYG, to magnitude 6.5) with the celestial pole'],
  ['showStarNames', 'Names', 'Names of the brightest stars'],
  ['showConstellations', 'Lines', 'Constellation figures'],
  ['showTrails', 'Trails', 'Star trails over the duration set alongside'],
  ['showRadiants', 'Radiants', 'Radiants of the active meteor showers']
];
const LAYERS: Chip[] = [
  ['showBuildings', 'Buildings', 'OpenStreetMap / Overture building volumes'],
  ['showSunShadows', 'Shadows', 'Sun shadows cast by terrain and buildings'],
  ['showMarkers', 'Markers', 'Markers flagged for the viewfinder'],
  ['showGrid', 'Grid', 'Rule-of-thirds grid']
];
const FLAGS: BoolKey[] = ['aimAtTarget', ...[...BODIES, ...NIGHT, ...LAYERS].map(([k]) => k)];
const LIGHT: [LightMode, string, string][] = [
  [LightMode.Auto, 'Auto', 'Sun by day, moon by night'],
  [LightMode.Sun, 'Sun', 'Sun only'],
  [LightMode.Moon, 'Moon', 'Moon only']
];
const RANGES_KM = [50, 100, 150, 200];
const LOS_WORD: Record<LosStatus, string> = { [LosStatus.Clear]: 'line of sight clear', [LosStatus.Marginal]: 'line of sight marginal', [LosStatus.Blocked]: 'line of sight blocked' };

function Chips({ list, c }: { list: Chip[]; c: Pick<Composition, BoolKey> }) {
  const update = compositionStore.getState().update;
  return (
    <>
      {list.map(([k, label, title]) => (
        <button key={k} aria-pressed={c[k]} data-flag={k} onClick={() => update({ [k]: !c[k] })} title={title}>
          {label}
        </button>
      ))}
    </>
  );
}

/** The viewfinder's View tab: aim, sky and scene layers, reference photo, credits. */
export function ViewTools() {
  // Only the flags: the whole store changes on every step of an aim drag.
  const c = useComposition(useShallow((s) => Object.fromEntries(FLAGS.map((k) => [k, s[k]])) as Pick<Composition, BoolKey>));
  const trailMinutes = useComposition((s) => s.trailMinutes);
  const pin2 = useWorld((s) => s.pin2);
  const lightSource = useSettings((s) => s.lightSource);
  const rangeKm = useSettings((s) => s.horizonRangeKm);
  const update = compositionStore.getState().update;
  const setting = settingsStore.getState().update;
  return (
    <>
      <Section title="Aim">
        <AimRow />
        <FormRow label="Camera">
          <button aria-pressed={c.aimAtTarget && !!pin2} data-flag="aimAtTarget" disabled={!pin2} onClick={() => update({ aimAtTarget: !c.aimAtTarget })} title={pin2 ? 'Keep the frame centred on the target location' : 'Place a target location on the map first'}>
            Aim at target
          </button>
        </FormRow>
      </Section>
      <Section title="Sky">
        <FormRow label="Bodies">
          <Chips list={BODIES} c={c} />
        </FormRow>
        <FormRow label="Night">
          <Chips list={NIGHT} c={c} />
          <label className="vrow-num">
            <input type="number" min={1} max={720} step={5} value={trailMinutes} onChange={(e) => update({ trailMinutes: Math.min(720, Math.max(1, Number(e.target.value) || 1)) })} aria-label="Trail duration, minutes" />
            <span className="muted">min</span>
          </label>
        </FormRow>
      </Section>
      <Section title="Scene">
        <FormRow label="Layers">
          <Chips list={LAYERS} c={c} />
        </FormRow>
        <FormRow label="Light">
          <div className="seg" role="radiogroup" aria-label="Light source for shadows">
            {LIGHT.map(([m, label, title]) => (
              <button key={m} role="radio" aria-checked={lightSource === m} className={lightSource === m ? 'on' : ''} title={title} onClick={() => setting({ lightSource: m })}>
                {label}
              </button>
            ))}
          </div>
        </FormRow>
        <FormRow label="Horizon">
          <select value={rangeKm} onChange={(e) => setting({ horizonRangeKm: Number(e.target.value) })} aria-label="Horizon range" title="How far the skyline sweep looks">
            {RANGES_KM.map((km) => (
              <option key={km} value={km}>
                {km} km
              </option>
            ))}
          </select>
        </FormRow>
      </Section>
      <Section title="Reference photo">
        <PhotoTools />
      </Section>
      <Section title="Credits">
        <Credits buildings={c.showBuildings} />
      </Section>
    </>
  );
}

function AimRow() {
  const pin = useWorld((s) => s.pin);
  const pin2 = useWorld((s) => s.pin2);
  const units = useSettings((s) => s.units);
  const profile = useTerrain((s) => s.profile);
  const profileKey = useTerrain((s) => s.profileKey);
  const name = useSavedName(pin2);
  if (!pin2) return <p className="muted hint">No target. Place one on the map.</p>;
  const brg = bearingDeg(pin, pin2);
  const fresh = profile && profileKey === profileKeyFor(worldStore.getState(), settingsStore.getState()) ? profile : null;
  const el = fresh ? fresh.los.targetAngleDeg : null;
  return (
    <div className="brow" data-aim="">
      <Dial az={brg} ink="terrain" />
      <span className="label">Target</span>
      <span className="time">{distance(distanceM(pin, pin2), units)}</span>
      <span className="az">{degrees(brg)}</span>
      <span className="note">
        {[name, el == null ? null : `elev ${el >= 0 ? '+' : ''}${degrees(el)}`].filter(Boolean).join(' · ')}
        {fresh && (
          <>
            {name || el != null ? ' · ' : ''}
            <span className={`los ${fresh.los.status.toLowerCase()}`}>{LOS_WORD[fresh.los.status]}</span>
          </>
        )}
      </span>
    </div>
  );
}

function Credits({ buildings }: { buildings: boolean }) {
  const tiles = useLod2((s) => s.tiles);
  const lod2 = lod2Drawn(tiles);
  const geoidUse = lod2GeoidUse(tiles);
  const geoidVersion = useOffline((s) => s.geoid?.version);
  const navigate = useNavigate();
  const toOffline = () => {
    uiStore.getState().setPanelTab(PanelTab.Map, PanelPage.Map);
    void navigate({ to: '/' });
  };
  return (
    <div className="credits">
      <p className="credit">Buildings: {BUILDINGS_ATTRIBUTION}</p>
      {buildings &&
        lod2.map((r) => (
          <p className="credit" key={r.id} data-lod2={r.id}>
            <a href={r.attributionUrl} target="_blank" rel="noreferrer">
              {r.attribution}
            </a>
          </p>
        ))}
      {buildings && geoidUse.gsi && geoidVersion && (
        <p className="credit" data-geoid-credit="">
          <a href={GEOID_DOWNLOAD_URL} target="_blank" rel="noreferrer">
            {geoidCredit(geoidVersion)}
          </a>
        </p>
      )}
      {buildings && geoidUse.approx && (
        <p className="credit" data-geoid-note="">
          <span className="alert">PLATEAU heights approximate outside central Tokyo: no GSI geoid</span>
          {' · '}
          <button className="link" onClick={toOffline}>
            Import on the map
          </button>
        </p>
      )}
    </div>
  );
}
