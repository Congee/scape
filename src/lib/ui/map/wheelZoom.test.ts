// oxlint-disable no-underscore-dangle -- MapLibre's scrollZoom internals
import { ScrollZoomHandler, type Map as MaplibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTrackpadWheel, trackpadStart } from './wheelZoom';

describe('trackpadStart', () => {
  it('takes small fractional pixel deltas as a trackpad', () => {
    expect(trackpadStart({ deltaY: 12.5, deltaMode: 0 })).toBe(true);
    expect(trackpadStart({ deltaY: -30, deltaMode: 0 })).toBe(true);
  });
  it('leaves notches, ticks, lines and zero to MapLibre', () => {
    expect(trackpadStart({ deltaY: 100, deltaMode: 0 })).toBe(false);
    expect(trackpadStart({ deltaY: 4.000244140625 * 3, deltaMode: 0 })).toBe(false);
    expect(trackpadStart({ deltaY: 3, deltaMode: 1 })).toBe(false);
    expect(trackpadStart({ deltaY: 0, deltaMode: 0 })).toBe(false);
  });
});

type Sz = ScrollZoomHandler & { _type: string | null; _delta: number; _timeout: ReturnType<typeof setTimeout>; _start: (e: unknown) => void };

describe('installTrackpadWheel', () => {
  let sz: Sz;
  let map: MaplibreMap;
  let clock = 10_000;
  const wheel = (deltaY: number) => sz.wheel({ deltaY, deltaMode: 0, shiftKey: false, ctrlKey: false, preventDefault() {} } as WheelEvent);

  beforeEach(() => {
    vi.stubGlobal('WheelEvent', { DOM_DELTA_LINE: 1 });
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const stub = { cooperativeGestures: { isEnabled: () => false } };
    sz = new ScrollZoomHandler(stub as unknown as MaplibreMap, () => {}, {} as never) as Sz;
    sz.enable();
    sz._start = vi.fn();
    map = { scrollZoom: sz } as unknown as MaplibreMap;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('applies a fresh trackpad delta at once instead of after the 40 ms guess', () => {
    wheel(20);
    expect(sz._type).toBeNull();
    expect(sz._timeout).toBeTruthy();
    clearTimeout(sz._timeout);

    installTrackpadWheel(map);
    clock += 1000;
    sz._type = null;
    sz._delta = 0;
    wheel(20);
    expect(sz._type).toBe('trackpad');
    expect(sz._delta).toBe(-20);
    expect(sz._start).toHaveBeenCalled();
  });

  it('keeps a fast trackpad stream on the trackpad path', () => {
    installTrackpadWheel(map);
    wheel(30);
    clock += 8;
    wheel(40);
    expect(sz._type).toBe('trackpad');
  });

  it('leaves a mouse notch to MapLibre', () => {
    installTrackpadWheel(map);
    wheel(100);
    expect(sz._type).toBeNull();
    clearTimeout(sz._timeout);
  });

  it('restores the handler and fails loudly on changed internals', () => {
    const orig = sz.wheel;
    installTrackpadWheel(map)();
    expect(sz.wheel).toBe(orig);
    expect(() => installTrackpadWheel({ scrollZoom: {} } as unknown as MaplibreMap)).toThrow(/internals changed/);
  });
});
