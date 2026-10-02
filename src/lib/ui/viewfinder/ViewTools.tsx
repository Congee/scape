import { useNavigate } from '@tanstack/react-router';
import { BUILDINGS_ATTRIBUTION } from '@data/buildingTiles';
import { GEOID_DOWNLOAD_URL, geoidCredit } from '@data/geoid';
import { compositionStore, useComposition, type Composition } from '@state/composition';
import { lod2Drawn, lod2GeoidUse, useLod2 } from '@state/lod2';
import { useOffline } from '@state/offline';
import { settingsStore, useSettings } from '@state/settings';
import { PanelPage, PanelTab, uiStore } from '@state/ui';
import { useShallow } from 'zustand/react/shallow';
import { LightSeg } from '../LightSeg';
import { FormRow, Section } from '../Section';
import { PhotoTools } from './PhotoTools';

type BoolKey = { [K in keyof Composition]: Composition[K] extends boolean ? K : never }[keyof Composition];
type Chip = [BoolKey, string, string];

const BODIES: Chip[] = [
  ['showSun', 'Sun', 'The sun disc, its label and its path'],
  ['showMoon', 'Moon', 'The moon disc, its label and its path'],
  ['showMilkyWay', 'Milky Way', 'NASA Milky Way map'],
  ['showPaths', 'Sun & moon paths', 'Sun, moon and Galactic Centre paths for the day'],
  ['showRainbow', 'Rainbow', 'Where a rainbow would stand: the 42° and 51° arcs opposite the sun']
];
const NIGHT: Chip[] = [
  ['showStars', 'Stars', 'Star field (HYG, to magnitude 6.5) with the celestial pole'],
  ['showStarNames', 'Star names', 'Names of the brightest stars'],
  ['showConstellations', 'Constellations', 'Constellation figures'],
  ['showTrails', 'Trails', 'Star trails over the duration set alongside'],
  ['showRadiants', 'Meteor radiants', 'Radiants of the active meteor showers']
];
const LAYERS: Chip[] = [
  ['showBuildings', 'Buildings', 'OpenStreetMap / Overture building volumes'],
  ['showSunShadows', 'Shadows', 'Sun shadows cast by terrain and buildings'],
  ['showMarkers', 'Markers', 'Markers flagged for the viewfinder'],
  ['showGrid', 'Grid', 'Rule-of-thirds grid']
];
const FLAGS: BoolKey[] = [...BODIES, ...NIGHT, ...LAYERS].map(([k]) => k);
const RANGES_KM = [50, 100, 150, 200];

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

/** The viewfinder's View tab: sky and scene layers, reference photo, credits. */
export function ViewTools() {
  // Only the flags: the whole store changes on every step of an aim drag.
  const c = useComposition(useShallow((s) => Object.fromEntries(FLAGS.map((k) => [k, s[k]])) as Pick<Composition, BoolKey>));
  const trailMinutes = useComposition((s) => s.trailMinutes);
  const rangeKm = useSettings((s) => s.horizonRangeKm);
  const showGc = useSettings((s) => s.showGc);
  const update = compositionStore.getState().update;
  const setting = settingsStore.getState().update;
  return (
    <>
      <Section title="Sky">
        <FormRow label="Bodies">
          <Chips list={BODIES} c={c} />
          <button aria-pressed={showGc} data-setting="showGc" onClick={() => setting({ showGc: !showGc })} title="Galactic Centre in the readouts and the day's events">
            Galactic Centre
          </button>
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
          <LightSeg />
        </FormRow>
        <FormRow label="Horizon range">
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
