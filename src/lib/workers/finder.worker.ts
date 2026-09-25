/// <reference lib="webworker" />
import { makeObserver } from '@core/astro/bodies';
import { describePass, findPasses, mergePasses, passesFilters, MERGE_GAP_MS, type FinderHit, type Pass } from '@core/astro/finder';
import { FinderResponseKind, type FinderRequest, type FinderResponse } from './finder.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
/** Chunk of the date range scanned between yields; long enough to amortise the band searches. */
const CHUNK_MS = 14 * 86_400_000;

let latestId = 0;

async function run(req: FinderRequest): Promise<void> {
  const t0 = performance.now();
  const q = req.query;
  const obs = makeObserver(req.pin, req.eyeM);
  const horizon = req.horizon ?? undefined;
  const span = Math.max(1, q.endMs - q.startMs);
  const hits: FinderHit[] = [];
  let total = 0;
  // A pass touching the chunk edge may continue into the next chunk.
  let open: Pass | null = null;

  const close = (passes: Pass[]) => {
    for (const p of passes) {
      total++;
      const hit = describePass(q, obs, p);
      if (passesFilters(hit, q, obs)) hits.push(hit);
    }
  };

  for (let chunkStart = q.startMs; chunkStart < q.endMs; chunkStart += CHUNK_MS) {
    const chunkEnd = Math.min(q.endMs, chunkStart + CHUNK_MS);
    const found = findPasses({ ...q, startMs: chunkStart, endMs: chunkEnd }, obs, horizon);
    const passes: Pass[] = open ? mergePasses([open, ...found]) : found;
    const last = passes.at(-1);
    open = last && chunkEnd < q.endMs && last.endMs >= chunkEnd - MERGE_GAP_MS ? passes.pop()! : null;
    close(passes);
    // oxlint-disable-next-line no-await-in-loop -- yields to the event loop between chunks
    await new Promise((r) => setTimeout(r));
    if (latestId !== req.id) return;
    const progress: FinderResponse = { kind: FinderResponseKind.Progress, id: req.id, fraction: (chunkEnd - q.startMs) / span, hits: [...hits], total };
    scope.postMessage(progress);
  }
  if (open) close([open]);
  const done: FinderResponse = { kind: FinderResponseKind.Done, id: req.id, hits, total, elapsedMs: performance.now() - t0 };
  scope.postMessage(done);
}

scope.addEventListener('message', (e: MessageEvent<FinderRequest>) => {
  const req = e.data;
  latestId = req.id;
  run(req).catch((err: unknown) => {
    if (latestId !== req.id) return;
    const message = err instanceof Error ? err.message : String(err);
    scope.postMessage({ kind: FinderResponseKind.Error, id: req.id, message } satisfies FinderResponse);
  });
});
