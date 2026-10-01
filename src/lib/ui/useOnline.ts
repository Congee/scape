import { useSyncExternalStore } from 'react';

const subscribe = (fn: () => void) => {
  addEventListener('online', fn);
  addEventListener('offline', fn);
  return () => {
    removeEventListener('online', fn);
    removeEventListener('offline', fn);
  };
};

/** Whether the browser thinks it is online, following changes. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
