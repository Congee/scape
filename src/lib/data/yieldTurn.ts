/** A macrotask turn, so a message already queued for this thread lands first. */
export function yieldTurn(): Promise<void> {
  const { port1, port2 } = new MessageChannel();
  return new Promise((resolve) => {
    port1.addEventListener(
      'message',
      () => {
        port1.close();
        resolve();
      },
      { once: true }
    );
    port1.start();
    port2.postMessage(null);
  });
}
