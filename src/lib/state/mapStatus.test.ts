import { describe, expect, it } from 'vitest';
import { mapNotice, mapStatusStore, MapNoticeKind } from './mapStatus';

describe('map notice', () => {
  it('says nothing when the map can draw', () => {
    expect(mapNotice({ online: true, tileError: false, satGap: false })).toBeNull();
  });

  it('names each condition in plain words', () => {
    expect(mapNotice({ online: true, tileError: true, satGap: false })).toEqual({ kind: MapNoticeKind.TilesFailed, text: "Map tiles couldn't load", retry: true });
    expect(mapNotice({ online: true, tileError: false, satGap: true })?.text).toBe('No satellite imagery here without a MapTiler key');
    expect(mapNotice({ online: false, tileError: false, satGap: false })?.text).toBe('Offline: showing cached map only');
  });

  it('lets offline explain the failures it causes', () => {
    expect(mapNotice({ online: false, tileError: true, satGap: true })?.kind).toBe(MapNoticeKind.Offline);
    expect(mapNotice({ online: true, tileError: true, satGap: true })?.kind).toBe(MapNoticeKind.TilesFailed);
  });

  it('puts the drawing hint above everything else', () => {
    expect(mapNotice({ online: false, tileError: true, satGap: true, drawing: true })).toEqual({ kind: MapNoticeKind.Drawing, text: 'Drag a rectangle on the map; Esc cancels.', retry: false });
  });

  it('clears the error on retry and drops its source with it', () => {
    const s = mapStatusStore.getState();
    s.setError('AJAXError: Failed to fetch (0): https://x', 'openmaptiles');
    expect(mapStatusStore.getState().errorSource).toBe('openmaptiles');
    const seq = mapStatusStore.getState().retrySeq;
    s.retry();
    expect(mapStatusStore.getState()).toMatchObject({ error: null, retrySeq: seq + 1 });
    s.setError(null, 'openmaptiles');
    expect(mapStatusStore.getState().errorSource).toBeNull();
  });
});
