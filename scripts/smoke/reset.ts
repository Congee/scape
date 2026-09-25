// Clears the app's persisted `scape.*` state before an agent-browser smoke.
// Usage: bun scripts/smoke/reset.ts <cdp-port> <origin>
import { Tab } from './cdp';

const [cdp, origin] = process.argv.slice(2);
const tab = await Tab.open(Number(cdp), origin);
await tab.fresh(origin);
tab.close();
