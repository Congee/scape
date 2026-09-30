import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildingsKind, type BuildingsResponse, type MaskRequest } from '@workers/buildings.protocol';
import { requestShadowMask, shadowMaskPending } from './buildings';

const shade = (r: MaskRequest): BuildingsResponse => ({ kind: BuildingsKind.Shade, id: r.id, centre: r.centre, originE: r.originE, originN: r.originN, nx: r.nx, ny: r.ny, cellM: r.cellM, mask: new Uint8Array(r.nx * r.ny), lod2: [], tallM: 0, ms: 1 });

describe('shadowMaskPending', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('holds until the worker answers the newest mask request', () => {
    let onMessage: ((e: { data: BuildingsResponse }) => void) | undefined;
    const sent: MaskRequest[] = [];
    vi.stubGlobal(
      'Worker',
      class {
        addEventListener(_: string, f: NonNullable<typeof onMessage>) {
          onMessage = f;
        }
        postMessage(r: MaskRequest) {
          if (r.kind === BuildingsKind.Mask) sent.push(r);
        }
      }
    );
    const rect = { originE: -100, originN: -100, nx: 100, ny: 100, cellM: 2 };
    expect(shadowMaskPending()).toBe(false);
    requestShadowMask({ lat: 51.9, lng: 4.48 }, rect, 200, 50, 1, true, 500, 1);
    requestShadowMask({ lat: 51.91, lng: 4.48 }, rect, 235, 51, 1, true, 500, 1);
    expect(shadowMaskPending()).toBe(true);
    onMessage!({ data: shade(sent[0]) });
    expect(shadowMaskPending()).toBe(true);
    onMessage!({ data: shade(sent[1]) });
    expect(shadowMaskPending()).toBe(false);
    requestShadowMask({ lat: 51.92, lng: 4.48 }, rect, 235, 51, 1, true, 500, 1);
    expect(shadowMaskPending()).toBe(true);
    onMessage!({ data: { kind: BuildingsKind.Error, id: sent[2].id, error: 'boom' } });
    expect(shadowMaskPending()).toBe(false);
  });
});
