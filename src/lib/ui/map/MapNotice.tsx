import { mapNotice, MapNoticeKind, mapStatusStore, useMapStatus } from '@state/mapStatus';
import { useOffline } from '@state/offline';
import { useOnline } from '../useOnline';

/** What the map can't draw right now, in one line; gone once it can. */
export function useMapNotice() {
  const online = useOnline();
  const tileError = useMapStatus((s) => s.error !== null);
  const satGap = useMapStatus((s) => s.satGap);
  const drawing = useOffline((s) => s.drawing);
  return mapNotice({ online, tileError, satGap, drawing });
}

export function MapNotice() {
  const notice = useMapNotice();
  return (
    <div className="map-notice-slot" role="status">
      {notice && (
        <p className="map-notice" data-kind={notice.kind} role={notice.kind === MapNoticeKind.TilesFailed ? 'alert' : undefined}>
          {notice.text}
          {notice.retry && (
            <button className="btn-link" onClick={() => mapStatusStore.getState().retry()}>
              Retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}
