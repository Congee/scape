import { useState } from 'react';
import { makeObserver, SkyBody } from '@core/astro/bodies';
import { position } from '@core/astro/positions';
import { compass, degrees, distance } from '@core/format';
import { distanceM } from '@core/geo/geodesy';
import { depthOfField, panoramaShots } from '@core/optics/dof';
import { aperturesFor, cocMm, CocRule, effectiveOptics, equivalentFocalMm, fitToLens, F_STOPS, frameFov, isCameraBody, lensFocals, maxApertureAt, Orientation, SENSORS, sensorPixels, tcFactor, Teleconverter, type SensorFormat } from '@core/optics/fov';
import { aimFor, compositionStore, useComposition } from '@state/composition';
import { applyKit, defaultKitName, gearStore, kitMatches, lensById, sensorById, useGear, zoomPatch } from '@state/gear';
import { capturePlan, plansStore } from '@state/plans';
import { settingsStore, useSettings } from '@state/settings';
import { profileKeyFor, useTerrain } from '@state/terrain';
import { useWorld, worldStore } from '@state/world';
import { GearSearch } from './GearSearch';

const signed = (deg: number) => `${deg >= 0 ? '+' : ''}${degrees(deg)}`;
const megapixels = (s: SensorFormat) => {
  const p = sensorPixels(s);
  return p ? `${Math.round(p / 1e5) / 10} MP` : null;
};
const dist = (m: number, units: Parameters<typeof distance>[1]) => (Number.isFinite(m) ? distance(m, units) : '∞');

export function FramePanel() {
  const c = useComposition();
  const cameras = useGear((s) => s.cameras);
  const focals = useGear((s) => s.focalPresets);
  const lenses = useGear((s) => s.lenses);
  const kits = useGear((s) => s.kits);
  const pin = useWorld((s) => s.pin);
  const pin2 = useWorld((s) => s.pin2);
  const pinHeightM = useWorld((s) => s.pinHeightM);
  const time = useWorld((s) => s.time);
  const units = useSettings((s) => s.units);
  const cocRule = useSettings((s) => s.cocRule);
  const profile = useTerrain((s) => s.profile);
  const profileKey = useTerrain((s) => s.profileKey);
  const [kitName, setKitName] = useState<string | null>(null);
  const [planName, setPlanName] = useState('');
  const [saved, setSaved] = useState('');

  const fresh = profile && profileKey === profileKeyFor(worldStore.getState(), settingsStore.getState()) ? profile : null;
  const sensor = sensorById(c.sensorId, cameras);
  const lens = lensById(c.lensId, lenses);
  const prime = lens !== null && lens.minMm === lens.maxMm;
  const isBody = isCameraBody(sensor.id);
  const opt = effectiveOptics(c);
  // Only a zoom's two ends are quoted; the widest aperture between them is interpolated, so say so.
  const apQuoted = lens == null || c.focalMm <= lens.minMm || c.focalMm >= lens.maxMm;
  const tcf = tcFactor(c.teleconverters);
  const tc = c.teleconverters.length > 0;
  const fov = frameFov(sensor, opt.focalMm, c.orientation);
  const aim = aimFor(c, { pin, pin2 }, fresh?.los.targetAngleDeg ?? null);
  const targetM = pin2 ? distanceM(pin, pin2) : null;
  const focusM = c.focusDistM ?? targetM;
  const pixels = sensorPixels(sensor);
  const coc = cocMm(sensor, pixels, cocRule);
  const dof = focusM ? depthOfField(opt.focalMm, opt.fNumber, coc, focusM) : null;
  const pano = c.panoTotalDeg ? panoramaShots(c.panoTotalDeg, fov.hDeg, c.panoOverlap) : null;
  const update = compositionStore.getState().update;
  const setSetting = settingsStore.getState().update;

  const aimAt = (body: SkyBody) => {
    const p = position(body, new Date(time), makeObserver(pin, pinHeightM));
    compositionStore.getState().aim(p.azimuth, Math.max(0, p.altitude));
  };
  const setFocal = (v: number) => update(zoomPatch(c, v));
  // Only a 1.4× and a 2.0× exist, so one of each is the whole stack a body can take.
  const toggleTc = (t: Teleconverter) => update({ teleconverters: c.teleconverters.includes(t) ? c.teleconverters.filter((x) => x !== t) : [...c.teleconverters, t].toSorted((a, b) => a - b) });
  const selectLens = (id: string) => {
    const l = lensById(id || null, lenses);
    update(l ? { lensId: l.id, ...fitToLens(l, c.focalMm, c.fNumber) } : { lensId: null });
  };
  const saveKit = () => {
    if (kitName?.trim()) gearStore.getState().saveKit(kitName.trim(), c.sensorId, c.lensId);
    setKitName(null);
  };
  const savePlan = async () => {
    const plan = capturePlan(planName);
    await plansStore.getState().save(plan);
    setSaved(plan.name);
    setPlanName('');
  };

  return (
    <div className="frame">
      <h3>Camera</h3>
      {(kits.length > 0 || isBody) && (
        <div className="chips kits" aria-label="Kits">
          <span className="k">Kits</span>
          {kits.map((k) => (
            <button key={k.id} className={kitMatches(k, c) ? 'on' : ''} title={k.name} onClick={() => applyKit(k)}>
              {k.name}
            </button>
          ))}
          {isBody && kitName === null && !kits.some((k) => kitMatches(k, c)) && (
            <button onClick={() => setKitName(defaultKitName(sensor.name, lens?.name ?? null))}>+ Save kit</button>
          )}
        </div>
      )}
      {kitName !== null && (
        <div className="field-row kit-name">
          <input
            autoFocus
            value={kitName}
            onChange={(e) => setKitName(e.target.value)}
            onKeyDown={(e) => (e.key === 'Enter' ? saveKit() : e.key === 'Escape' ? setKitName(null) : undefined)}
            aria-label="Kit name"
          />
          <button onClick={saveKit} disabled={!kitName.trim()}>
            Save
          </button>
        </div>
      )}
      <GearSearch />
      <div className="kv">
        <span className="k">Camera</span>
        <b className="v">
          <select value={sensor.id} onChange={(e) => update({ sensorId: e.target.value })} aria-label="Camera or sensor format">
            {cameras.length > 0 && (
              <optgroup label="My cameras">
                {cameras.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {megapixels(s) ? ` · ${megapixels(s)}` : ''}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Sensor formats">
              {SENSORS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          </select>
        </b>
        {isBody && (
          <b className="v wide muted">
            {sensor.widthMm} × {sensor.heightMm} mm{megapixels(sensor) ? ` · ${megapixels(sensor)}` : ''}
            {sensor.mount ? ` · ${sensor.mount === 'fixed' ? 'fixed lens' : `${sensor.mount} mount`}` : ''}
          </b>
        )}
        <span className="k">Lens</span>
        <b className="v">
          <select value={lens?.id ?? ''} onChange={(e) => selectLens(e.target.value)} aria-label="Lens">
            <option value="">Any focal length</option>
            {lenses.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </b>
        <span className="k">Orientation</span>
        <b className="v">
          <span className="seg">
            {[Orientation.Landscape, Orientation.Portrait].map((o) => (
              <button key={o} className={c.orientation === o ? 'on' : ''} onClick={() => update({ orientation: o })}>
                {o}
              </button>
            ))}
          </span>
        </b>
        <span className="k">Focal length</span>
        {/* Read-only: the slider, the quick picks and the viewfinder wheel already set it, and typing fights the lens clamp on every keystroke. */}
        <b className="v" role="status">
          {c.focalMm} mm <span className="muted">{tc ? `· ${opt.focalMm} mm with the ${tcf}× ` : ''}· {equivalentFocalMm(sensor, opt.focalMm).toFixed(0)} mm equiv.</span>
        </b>
        {lens && !prime && (
          <b className="v wide">
            <input
              type="range"
              className="zoom"
              min={lens.minMm}
              max={lens.maxMm}
              step={1}
              value={c.focalMm}
              onChange={(e) => setFocal(Number(e.target.value))}
              aria-label="Zoom, millimetres"
            />
          </b>
        )}
      </div>
      {!prime && (
        <div className="chips" aria-label="Focal length presets">
          {(lens ? lensFocals(lens, focals) : focals).map((f) => (
            <button key={f} className={Math.abs(f - c.focalMm) < 0.05 ? 'on' : ''} onClick={() => setFocal(f)}>
              {f}
            </button>
          ))}
        </div>
      )}
      <div className="kv">
        <span className="k">Teleconverter</span>
        <b className="v">
          <span className="seg">
            <button className={tc ? '' : 'on'} onClick={() => update({ teleconverters: [] })} title="No teleconverter">
              None
            </button>
            {[Teleconverter.X14, Teleconverter.X20].map((t) => (
              <button
                key={t}
                className={c.teleconverters.includes(t) ? 'on' : ''}
                aria-pressed={c.teleconverters.includes(t)}
                onClick={() => toggleTc(t)}
                title={`${t}× teleconverter: ${t}× the focal length, ${t}× the f-number. Stacks with the other one.`}
              >
                {t}×
              </button>
            ))}
          </span>
          {tc && <span className="muted">· {tcf}× in total</span>}
        </b>
        <span className="k">Aperture</span>
        <b className="v">
          <select value={c.fNumber} onChange={(e) => update({ fNumber: Number(e.target.value) })} aria-label="Aperture">
            {aperturesFor(lens, c.focalMm, [...F_STOPS, c.fNumber]).map((f) => (
              <option key={f} value={f}>
                f/{f}
              </option>
            ))}
          </select>
          {lens?.maxApertureLong != null && (
            <span className="muted" title="Only the two ends are the maker's figures. Between them this is interpolated: a real zoom holds its wider end for part of the range and then steps.">
              · f/{lens.maxAperture}–{lens.maxApertureLong} zoom, {apQuoted ? '' : 'about '}f/{maxApertureAt(lens, c.focalMm)} widest at {c.focalMm} mm
            </span>
          )}
          {tc && <span className="muted">· f/{opt.fNumber} with the {tcf}×</span>}
        </b>
        <span className="k">Field of view</span>
        <b className="v">
          {fov.hDeg.toFixed(1)}° × {fov.vDeg.toFixed(1)}° <span className="muted">· diagonal {fov.dDeg.toFixed(1)}°</span>
        </b>
      </div>

      <h3>Aim</h3>
      <label className="toggle">
        <input type="checkbox" checked={c.aimAtTarget} disabled={!pin2} onChange={(e) => update({ aimAtTarget: e.target.checked })} />
        <span>Aim at the target location{pin2 ? '' : ' (place a target first)'}</span>
      </label>
      <div className="kv">
        <span className="k">Azimuth</span>
        <b className="v">
          {aim.locked ? (
            <>
              {degrees(aim.azimuthDeg)} {compass(aim.azimuthDeg)}
            </>
          ) : (
            <>
              <input type="number" min={0} max={360} step={0.5} value={Number(c.azimuthDeg.toFixed(1))} onChange={(e) => compositionStore.getState().aim(Number(e.target.value) || 0, c.elevationDeg)} aria-label="Azimuth, degrees" />
              <span className="muted">° {compass(c.azimuthDeg)}</span>
            </>
          )}
        </b>
        <span className="k">Elevation</span>
        <b className="v">
          {aim.locked ? (
            signed(aim.elevationDeg)
          ) : (
            <>
              <input type="number" min={-89} max={89} step={0.5} value={Number(c.elevationDeg.toFixed(1))} onChange={(e) => compositionStore.getState().aim(c.azimuthDeg, Number(e.target.value) || 0)} aria-label="Elevation, degrees" />
              <span className="muted">°</span>
            </>
          )}
        </b>
      </div>
      <div className="actions">
        <button onClick={() => aimAt(SkyBody.Sun)} title="Point the camera at the sun at the simulated time">
          Aim at sun
        </button>
        <button onClick={() => aimAt(SkyBody.Moon)} title="Point the camera at the moon at the simulated time">
          Aim at moon
        </button>
        <button onClick={() => aimAt(SkyBody.Gc)} title="Point the camera at the Galactic Centre">
          Aim at GC
        </button>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={c.showFov} onChange={(e) => update({ showFov: e.target.checked })} />
        <span>Show the field-of-view cone on the map (drag its tip to aim, its edge to zoom)</span>
      </label>
      <div className="kv">
        <span className="k">Cone length</span>
        <b className="v">
          <input
            type="number"
            min={50}
            step={100}
            value={Math.round(c.fovRangeM ?? targetM ?? 5000)}
            onChange={(e) => update({ fovRangeM: Math.max(50, Number(e.target.value) || 50) })}
            aria-label="Cone length, metres"
          />
          <span className="muted">m </span>
          {c.fovRangeM != null && (
            <button className="link" onClick={() => update({ fovRangeM: null })}>
              auto
            </button>
          )}
        </b>
      </div>

      <h3>Depth of field</h3>
      <div className="kv">
        <span className="k">Focus at</span>
        <b className="v">
          <input
            type="number"
            min={0.1}
            step={1}
            value={focusM ? Number(focusM.toFixed(focusM < 10 ? 1 : 0)) : ''}
            placeholder="target"
            onChange={(e) => update({ focusDistM: e.target.value ? Math.max(0.1, Number(e.target.value)) : null })}
            aria-label="Focus distance, metres"
          />
          <span className="muted">m </span>
          {c.focusDistM != null && (
            <button className="link" onClick={() => update({ focusDistM: null })}>
              target
            </button>
          )}
        </b>
        <span className="k">Sharp from</span>
        <b className="v">{dof ? `${dist(dof.nearM, units)} to ${dist(dof.farM, units)}` : 'set a focus distance'}</b>
        <span className="k">Hyperfocal</span>
        <b className="v">
          {dist(dof?.hyperfocalM ?? depthOfField(opt.focalMm, opt.fNumber, coc, 1).hyperfocalM, units)}{' '}
          <span className="muted">
            · CoC {coc.toFixed(3)} mm{cocRule === CocRule.PixelPitch && (pixels ? ' · pixel pitch' : ' · needs the pixel count')}
          </span>
        </b>
        <span className="k">CoC rule</span>
        <b className="v">
          <span className="seg">
            <button className={cocRule === CocRule.Standard ? 'on' : ''} onClick={() => setSetting({ cocRule: CocRule.Standard })} title="Zeiss 0.03 mm scaled by the crop factor">
              Standard
            </button>
            <button className={cocRule === CocRule.PixelPitch ? 'on' : ''} onClick={() => setSetting({ cocRule: CocRule.PixelPitch })} title="Twice the pixel pitch, for large prints">
              Pixel pitch
            </button>
          </span>
        </b>
      </div>

      <h3>Panorama</h3>
      <label className="toggle">
        <input type="checkbox" checked={c.panoTotalDeg != null} onChange={(e) => update({ panoTotalDeg: e.target.checked ? Math.max(fov.hDeg, 120) : null })} />
        <span>Plan a stitched panorama</span>
      </label>
      {pano && c.panoTotalDeg != null && (
        <div className="kv">
          <span className="k">Total angle</span>
          <b className="v">
            <input type="number" min={1} max={360} step={5} value={Math.round(c.panoTotalDeg)} onChange={(e) => update({ panoTotalDeg: Math.min(360, Math.max(1, Number(e.target.value) || 1)) })} aria-label="Panorama total angle" />
            <span className="muted">°</span>
          </b>
          <span className="k">Overlap</span>
          <b className="v">
            <input type="number" min={0} max={80} step={5} value={Math.round(c.panoOverlap * 100)} onChange={(e) => update({ panoOverlap: Math.min(0.8, Math.max(0, Number(e.target.value) / 100)) })} aria-label="Frame overlap, percent" />
            <span className="muted">%</span>
          </b>
          <span className="k">Frames</span>
          <b className="v">
            {pano.shots} {c.orientation === Orientation.Portrait ? 'portrait' : 'landscape'} frames, {pano.stepDeg.toFixed(1)}° apart
          </b>
        </div>
      )}

      <h3>Plan</h3>
      <div className="field-row" style={{ padding: '0 6px' }}>
        <input placeholder="Plan name" value={planName} onChange={(e) => setPlanName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && planName.trim() && savePlan()} aria-label="Plan name" />
        <button onClick={savePlan} disabled={!planName.trim()}>
          Save plan
        </button>
      </div>
      {saved && <p className="muted hint ok">Saved “{saved}” to the Library.</p>}
    </div>
  );
}
