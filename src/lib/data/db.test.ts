import { describe, expect, it } from 'vitest';
import { DB_VERSION, upgradeScape, type Upgradable } from './db';

function recorder() {
  const made: string[] = [];
  const d: Upgradable = {
    createObjectStore(name, options) {
      expect(options.keyPath).toBe('id');
      return {
        createIndex(index, keyPath) {
          made.push(`${name}.${index}:${keyPath}`);
        }
      };
    }
  };
  return { d, made };
}

describe('upgradeScape', () => {
  it('builds every store on a fresh database', () => {
    const { d, made } = recorder();
    upgradeScape(d, 0);
    expect(made).toEqual(['locations.byName:name', 'markers.byName:name', 'plans.byName:name', 'searches.byName:name', 'models.byName:name']);
  });

  it('adds only the models store from v3', () => {
    const { d, made } = recorder();
    upgradeScape(d, 3);
    expect(made).toEqual(['models.byName:name']);
    expect(DB_VERSION).toBe(4);
  });

  it('does nothing at the current version', () => {
    const { d, made } = recorder();
    upgradeScape(d, DB_VERSION);
    expect(made).toEqual([]);
  });
});
