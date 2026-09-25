// Flags agent-browser calls in scripts/smoke without --cdp (a bare call launches a focus-stealing browser) or --session (agents share "default"),
// browser launches not hidden with `open -g -j` (`-g` alone still shows a window), and Brave launched with `open -a` or without --headless=new.
// Usage: bun scripts/check-smoke.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dir, '..');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(sh|ts|js|py)$/.test(e.name) ? [join(dir, e.name)] : []));
const SPAWN = /\bnohup\b|\bspawn\w*\(|\bexec(File)?\w*[\s(]/;

/** Comment-free commands with their first line; shell `\` continuations and spawn calls with open brackets span lines. */
function commands(text: string): { line: number; code: string }[] {
  const out: { line: number; code: string }[] = [];
  let cur: { line: number; code: string } | null = null;
  let depth = 0;
  text.split('\n').forEach((raw, i) => {
    const code = raw.replace(/^\s*(#|\/\/|\*|\/\*).*$/, '').replace(/\s#\s.*$/, '');
    cur = cur ? { line: cur.line, code: `${cur.code} ${code}` } : { line: i + 1, code };
    if (SPAWN.test(cur.code)) depth += (code.match(/[([]/g) ?? []).length - (code.match(/[)\]]/g) ?? []).length;
    if (/\\\s*$/.test(code) || depth > 0) return;
    out.push(cur);
    cur = null;
    depth = 0;
  });
  if (cur) out.push(cur);
  return out;
}

const bad: string[] = [];
for (const path of files(join(root, 'scripts')).filter((p) => p !== import.meta.path)) {
  const f = relative(root, path);
  for (const { line, code } of commands(readFileSync(path, 'utf8'))) {
    const at = `${f}:${line}`;
    const open = (/\bopen\s+-/.test(code) && /-a\s/.test(code)) || (/['"`]open['"`]/.test(code) && /['"`]-a['"`]/.test(code));
    if (open && /brave/i.test(code)) bad.push(`${at}: Brave launched with open -a; use brave_launch from scripts/smoke/brave.sh`);
    else if (open && !/\bopen\s+-g\s+-j\b|['"`]-g['"`],\s*['"`]-j['"`]/.test(code)) bad.push(`${at}: browser launch without open -g -j`);
    const launch = !open && (/--remote-debugging-port/.test(code) || (SPAWN.test(code) && /brave/i.test(code)));
    if (launch && !/firefox|\s-profile\s/i.test(code) && !code.includes('--headless=new')) bad.push(`${at}: Brave launch without --headless=new`);
    if (!f.startsWith('scripts/smoke/') || !/\bagent-browser\b/.test(code)) continue;
    const missing = ['--cdp', '--session'].filter((flag) => !code.includes(flag));
    if (missing.length) bad.push(`${at}: agent-browser without ${missing.join(' and ')}`);
  }
}
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
