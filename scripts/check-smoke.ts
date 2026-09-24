// Flags agent-browser calls in scripts/smoke without --cdp (a bare call launches a focus-stealing browser) or --session (agents share "default"),
// and browser launches not hidden with `open -g -j` (`-g` alone still shows a window).
// Usage: bun scripts/check-smoke.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dir, 'smoke');
const bad: string[] = [];
for (const f of readdirSync(dir).filter((name) => /\.(sh|ts|js|py)$/.test(name))) {
  readFileSync(join(dir, f), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const code = line.replace(/^\s*(#|\/\/|\*|\/\*).*$/, '').replace(/\s#\s.*$/, '');
      if (/\bopen\s+-/.test(code) && /-a\s/.test(code) && !/\bopen\s+-g\s+-j\b/.test(code)) bad.push(`scripts/smoke/${f}:${i + 1}: browser launch without open -g -j`);
      if (!/\bagent-browser\b/.test(code)) return;
      const missing = ['--cdp', '--session'].filter((flag) => !code.includes(flag));
      if (missing.length) bad.push(`scripts/smoke/${f}:${i + 1}: agent-browser without ${missing.join(' and ')}`);
    });
}
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
