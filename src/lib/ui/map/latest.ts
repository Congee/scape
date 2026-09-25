/** Wraps an async source so only the most recent call resolves with a value; superseded calls resolve `undefined`. */
export const latestOnly = <T>(source: () => Promise<T>): (() => Promise<T | undefined>) => {
  let seq = 0;
  return async () => {
    const mine = ++seq;
    const value = await source();
    return mine === seq ? value : undefined;
  };
};
