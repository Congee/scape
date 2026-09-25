import { describe, expect, it } from 'vitest';
import { latestOnly } from './latest';

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe('latestOnly', () => {
  it('drops an older answer that lands after a newer one', async () => {
    const pending = [deferred<string>(), deferred<string>()];
    let i = 0;
    const ask = latestOnly(() => pending[i++].promise);
    const older = ask();
    const newer = ask();
    pending[1].resolve('new');
    pending[0].resolve('old');
    expect(await newer).toBe('new');
    expect(await older).toBeUndefined();
  });

  it('passes a lone call through', async () => {
    const ask = latestOnly(async () => 7);
    expect(await ask()).toBe(7);
  });
});
