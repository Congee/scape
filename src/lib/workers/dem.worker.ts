/// <reference lib="webworker" />
import type { DemRequest } from './dem.protocol';
import { demServer } from './dem.serve';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const serve = demServer((res, transfer) => scope.postMessage(res, transfer));

scope.addEventListener('message', (e: MessageEvent<DemRequest>) => void serve(e.data));
