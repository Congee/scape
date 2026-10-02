import { describe, expect, it } from 'vitest';
import { CoordFormat } from '@core/geo/coords';
import { ClickMode, DEFAULT_SETTINGS, migrateSettings, SETTINGS_PERSIST, SETTINGS_VERSION } from './settings';

describe('migrateSettings', () => {
  it('reads the v0 toggle as a click mode', () => {
    expect(migrateSettings({ clickMovesPin: true }, 0).clickMode).toBe(ClickMode.Camera);
    expect(migrateSettings({ clickMovesPin: false }, 0).clickMode).toBe(ClickMode.Off);
  });

  it('defaults to the camera when v0 never stored the toggle', () => {
    expect(migrateSettings({ units: DEFAULT_SETTINGS.units }, 0).clickMode).toBe(ClickMode.Camera);
    expect(migrateSettings(undefined, 0).clickMode).toBe(ClickMode.Camera);
  });

  it('drops the old key and keeps the rest', () => {
    const s = migrateSettings({ clickMovesPin: false, hour12: false }, 0);
    expect(s).not.toHaveProperty('clickMovesPin');
    expect(s.hour12).toBe(false);
  });

  it('moves the old dd default to signed once', () => {
    expect(DEFAULT_SETTINGS.coordFormat).toBe(CoordFormat.Signed);
    expect(migrateSettings({ coordFormat: CoordFormat.DD }, 1).coordFormat).toBe(CoordFormat.Signed);
    expect(migrateSettings({ coordFormat: CoordFormat.DD, clickMovesPin: false }, 0)).toMatchObject({ coordFormat: CoordFormat.Signed, clickMode: ClickMode.Off });
    expect(migrateSettings({ coordFormat: CoordFormat.DMS }, 1).coordFormat).toBe(CoordFormat.DMS);
    expect(migrateSettings({ ...DEFAULT_SETTINGS, coordFormat: CoordFormat.DD }, SETTINGS_VERSION).coordFormat).toBe(CoordFormat.DD);
  });

  it('leaves current settings alone', () => {
    const now = { ...DEFAULT_SETTINGS, clickMode: ClickMode.Target };
    expect(migrateSettings(now, SETTINGS_VERSION)).toEqual(now);
  });

  it('is wired to the store', () => {
    expect(SETTINGS_PERSIST.version).toBe(SETTINGS_VERSION);
    expect(SETTINGS_PERSIST.migrate).toBe(migrateSettings);
  });
});
