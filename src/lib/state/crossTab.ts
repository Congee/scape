/**
 * Zustand's `persist` writes localStorage but never tells the other tabs, so a map in one tab and a
 * viewfinder in another drift apart forever. Each tab announces its own persisted changes and the
 * others re-read the storage; a rehydrate never announces back, so there is no echo loop.
 */

import { compositionStore } from './composition';
import { gearStore } from './gear';
import { settingsStore } from './settings';
import { worldStore } from './world';

const CHANNEL = 'scape.state';

interface Persisted<T> {
  getState(): T;
  subscribe(listener: () => void): () => void;
  persist: {
    getOptions(): { name?: string; partialize?: (state: T) => unknown };
    rehydrate(): Promise<void> | void;
  };
}

function syncStore<T>(store: Persisted<T>, channel: BroadcastChannel): () => void {
  const opts = store.persist.getOptions();
  const name = opts.name;
  if (!name) return () => {};
  const snapshot = () => JSON.stringify(opts.partialize ? opts.partialize(store.getState()) : store.getState());
  let last = snapshot();
  let applying = 0;
  let scheduled = false;
  const announce = () => {
    scheduled = false;
    const now = snapshot();
    // The live clock ticks the store every second without changing anything persisted.
    if (now === last) return;
    last = now;
    if (!applying) channel.postMessage(name);
  };
  const unsub = store.subscribe(() => {
    // `persist` notifies its subscribers before writing the storage, so announce once that write has landed.
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(announce);
  });
  const onMessage = (e: MessageEvent<string>) => {
    if (e.data !== name) return;
    applying++;
    void Promise.resolve(store.persist.rehydrate()).finally(() => {
      applying--;
      last = snapshot();
    });
  };
  channel.addEventListener('message', onMessage);
  return () => {
    unsub();
    channel.removeEventListener('message', onMessage);
  };
}

/** Keeps the camera, target, clock, framing, settings and gear identical in every open tab. */
export function startCrossTabSync(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  const stops = [
    syncStore(worldStore as unknown as Persisted<unknown>, channel),
    syncStore(compositionStore as unknown as Persisted<unknown>, channel),
    syncStore(settingsStore as unknown as Persisted<unknown>, channel),
    syncStore(gearStore as unknown as Persisted<unknown>, channel)
  ];
  return () => {
    for (const stop of stops) stop();
    channel.close();
  };
}
