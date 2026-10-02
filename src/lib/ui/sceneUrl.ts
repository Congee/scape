/** Store ↔ URL glue for the scene, shared by the map and the viewfinder. */

import { useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { compositionStore } from '@state/composition';
import { gearStore } from '@state/gear';
import { searchFor, stateFor, validateScene, type Scene, type SceneSearch } from '@state/urlState';
import { worldStore } from '@state/world';

const customSensors = () => gearStore.getState().cameras;

export function currentScene(): Scene {
  const w = worldStore.getState();
  const c = compositionStore.getState();
  return {
    pin: w.pin,
    pinHeightM: w.pinHeightM,
    pin2: w.pin2,
    pin2HeightM: w.pin2HeightM,
    pin2HeightAuto: w.pin2HeightAuto,
    view: { center: w.view.center, zoom: w.view.zoom, bearing: w.view.bearing ?? 0, pitch: w.view.pitch ?? 0 },
    aimLock: c.aimLock,
    azimuthDeg: c.azimuthDeg,
    elevationDeg: c.elevationDeg,
    focalMm: c.focalMm,
    orientation: c.orientation,
    teleconverters: c.teleconverters,
    sensorId: c.sensorId,
    time: w.live ? null : w.time,
    tz: w.tzAuto ? null : w.tz
  };
}

export const sceneSearchNow = (): SceneSearch => searchFor(currentScene(), customSensors());

const keyOf = (q: object) => JSON.stringify(validateScene(q as Record<string, unknown>));

/** Applies only what the search changes, so a URL that matches the stores is a no-op. */
export function applyScene(q: SceneSearch, fly: boolean): void {
  const custom = customSensors();
  const cur = currentScene();
  const next = stateFor(q, cur, custom);
  const was = searchFor(cur, custom);
  const now = searchFor(next, custom);
  const differs = (...keys: (keyof SceneSearch)[]) => keys.some((k) => was[k] !== now[k]);
  const w = worldStore.getState();
  if (differs('c')) w.setPin(next.pin);
  if (differs('ch')) w.setPinHeight(next.pinHeightM);
  const target = differs('tg', 'th');
  if (target) {
    w.setPin2(next.pin2);
    w.setPin2Height(next.pin2HeightM, next.pin2HeightAuto);
  }
  if (differs('t')) {
    if (next.time == null) w.setNow();
    else w.setTime(next.time);
  }
  if (differs('tz')) w.setTz(next.tz);
  if (differs('c', 'm', 'z', 'b', 'pt')) {
    const { center, zoom, bearing, pitch } = next.view;
    w.setView(next.view);
    if (fly) w.flyTo(center, zoom, false, { bearing, pitch });
  }
  if (differs('f', 'o', 'tc', 's')) compositionStore.getState().update({ focalMm: next.focalMm, orientation: next.orientation, teleconverters: next.teleconverters, sensorId: next.sensorId });
  // Last: moving the target re-locks a free aim.
  if (target || differs('a', 'az', 'el')) compositionStore.setState({ aimLock: next.aimLock, azimuthDeg: next.azimuthDeg, elevationDeg: next.elevationDeg });
}

/** Keeps the route's URL and the stores in step both ways; `fly` moves a mounted map too. */
export function useSceneUrl(to: '/' | '/viewfinder', search: SceneSearch, fly: boolean): void {
  const navigate = useNavigate();
  const router = useRouter();
  const written = useRef('');
  const key = keyOf(search);

  // URL → stores; our own write echoing back must not undo edits made since.
  useEffect(() => {
    if (key !== written.current) applyScene(search, fly);
    // oxlint-disable-next-line react/exhaustive-deps -- keyed on the search's content
  }, [key]);

  // Stores → URL, debounced; replaces history so drags and scrubbing do not spam it.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = '';
    const push = () => {
      const q = sceneSearchNow();
      const k = keyOf(q);
      if (k === keyOf(router.state.location.search)) return;
      written.current = k;
      void navigate({ to, replace: true, search: q });
    };
    const bump = () => {
      // The live clock ticks every second but a live URL carries no time.
      const k = keyOf(sceneSearchNow());
      if (k === last) return;
      last = k;
      clearTimeout(timer);
      timer = setTimeout(push, 500);
    };
    const unsubs = [worldStore.subscribe(bump), compositionStore.subscribe(bump)];
    // Normalise whatever the address bar carries, so it is always shareable.
    bump();
    return () => {
      for (const u of unsubs) u();
      clearTimeout(timer);
    };
  }, [navigate, router, to]);
}
