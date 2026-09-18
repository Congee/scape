import { describe, expect, it } from 'vitest';
import { Teleconverter } from '@core/optics/fov';
import { COMPOSITION_VERSION, DEFAULT_COMPOSITION, migrateComposition } from './composition';

describe('migrateComposition', () => {
  it('turns the v0 scalar teleconverter into a stack', () => {
    const v0 = { ...DEFAULT_COMPOSITION, teleconverters: undefined, teleconverter: Teleconverter.X20 };
    expect(migrateComposition(v0, 0).teleconverters).toEqual([Teleconverter.X20]);
  });

  it('reads v0 “none” as an empty stack', () => {
    expect(migrateComposition({ ...DEFAULT_COMPOSITION, teleconverter: 1 }, 0).teleconverters).toEqual([]);
    expect(migrateComposition({}, 0).teleconverters).toEqual([]);
  });

  it('drops the old key so it cannot come back', () => {
    expect(migrateComposition({ teleconverter: 2 }, 0)).not.toHaveProperty('teleconverter');
  });

  it('leaves a current profile alone', () => {
    expect(migrateComposition(DEFAULT_COMPOSITION, COMPOSITION_VERSION)).toEqual(DEFAULT_COMPOSITION);
  });
});
