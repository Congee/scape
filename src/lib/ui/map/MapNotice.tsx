import { mapNotice, mapStatusStore, useMapStatus } from '@state/mapStatus';
import { useOnline } from '../useOnline';

/** What the map can't draw right now, in one line; gone once it can. */
export function useMapNotice() {
  const online = useOnline();
  const tileError = useMapStatus((s) => s.error !== null);
  const satGap = useMapStatus((s) => s.satGap);
  return mapNotice({ online, tileError, satGap });
}

export function MapNotice() {
  const notice = useMapNotice();
  return (
    <div className="map-notice-slot" role="status">
      {notice && (
        <p className="map-notice" data-kind={notice.kind}>
          {notice.text}
          {notice.retry && (
            <button className="link" onClick={() => mapStatusStore.getState().retry()}>
              Retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}
