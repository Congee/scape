import { BUILDINGS_ATTRIBUTION } from '@data/buildingTiles';
import { compositionStore, useComposition, type Composition } from '@state/composition';
import { useWorld } from '@state/world';

type BoolKey = { [K in keyof Composition]: Composition[K] extends boolean ? K : never }[keyof Composition];

const CHIPS: [BoolKey, string, string][] = [
  ['showBuildings', 'Buildings', 'OpenStreetMap / Overture building volumes'],
  ['showPaths', 'Paths', 'Sun, moon and Galactic Centre paths for the day'],
  ['showMarkers', 'Markers', 'Markers flagged for the viewfinder'],
  ['showGrid', 'Grid', 'Rule-of-thirds grid'],
  ['showStars', 'Stars', 'Star field (HYG, to magnitude 6.5) with the celestial pole'],
  ['showStarNames', 'Names', 'Names of the brightest stars'],
  ['showConstellations', 'Lines', 'Constellation figures'],
  ['showMilkyWay', 'Milky Way', 'NASA Milky Way map'],
  ['showTrails', 'Trails', 'Star trails over the duration set in the Night tab'],
  ['showRadiants', 'Radiants', 'Radiants of the active meteor showers']
];

/** Layer chips for the viewfinder page; the aim chip makes the target lock visible and reversible. */
export function ViewTools() {
  const c = useComposition();
  const pin2 = useWorld((s) => s.pin2);
  const update = compositionStore.getState().update;
  return (
    <div className="vf-tools chips" aria-label="Viewfinder layers">
      <button className={c.aimAtTarget && pin2 ? 'on' : ''} disabled={!pin2} onClick={() => update({ aimAtTarget: !c.aimAtTarget })} title={pin2 ? 'Keep the frame centred on the target location' : 'Place a target location on the map first'}>
        Aim at target
      </button>
      {CHIPS.map(([k, label, title]) => (
        <button key={k} className={c[k] ? 'on' : ''} onClick={() => update({ [k]: !c[k] })} title={title}>
          {label}
        </button>
      ))}
      <p className="muted hint">Buildings: {BUILDINGS_ATTRIBUTION}</p>
    </div>
  );
}
