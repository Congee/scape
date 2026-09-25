// Touch half of timescrub.sh: on the tab already on the app, a vertical swipe over the Timeline tide curve leaves the time, a tap and a sideways drag set it.
// Usage: bun scripts/smoke/timescrub-touch.ts <cdp> <port> <tag> <shot-dir>; prints table rows, exits 1 on a failure.
/* oxlint-disable no-await-in-loop -- touch steps are sequential */
import { Tab } from './cdp';

const [cdp, port, tag, shots] = process.argv.slice(2);
const tab = await Tab.open(Number(cdp), `http://localhost:${port}`);
if (!(await tab.eval<boolean>('document.visibilityState === "visible"'))) throw new Error('the smoke tab is hidden; touch input would hang');

let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`| ${tag} ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
};
const sleep = (ms: number) => Bun.sleep(ms);
const SEL = '.timeline .tide-row .tide-curve';
type Box = { left: number; width: number; mid: number };
const box = () => tab.eval<Box>(`(() => { const r = document.querySelector('${SEL}').getBoundingClientRect(); return { left: r.left, width: r.width, mid: Math.round(r.top + r.height / 2) }; })()`);
const time = () => tab.eval<number>('__scape.world.getState().time');
const hm = () => tab.eval<string>('document.querySelector(".datebar input[type=time]").value');
const cursorX = () => tab.eval<number>(`(() => { const l = document.querySelector('${SEL} .scrub-cursor .now'); return l ? Math.round(l.getBoundingClientRect().left) : -1; })()`);
const scrollTop = () => tab.eval<number>(`(() => { let e = document.querySelector('${SEL}'); while (e && !(e.scrollHeight > e.clientHeight && /auto|scroll/.test(getComputedStyle(e).overflowY))) e = e.parentElement; return e ? Math.round(e.scrollTop) : -1; })()`);
const touch = (type: string, x?: number, y?: number) => tab.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y, id: 0 }] });
const xAt = (b: Box, f: number) => Math.round(b.left + b.width * f);

await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await tab.eval(`(() => { const u = __scape.ui.getState(); u.setPanelTab('Timeline'); u.setPanelCollapsed(false); __scape.world.getState().setTime(Date.parse('${process.env.DAY}')); return 1; })()`);
for (let i = 0; i < 60 && !(await tab.eval<boolean>(`!!document.querySelector('${SEL}')`)); i++) await sleep(250);
await tab.eval(`(() => { document.querySelector('${SEL}').scrollIntoView({ block: 'center' }); return 1; })()`);
await sleep(300);

// Mostly vertical, with a little sideways drift, as a thumb scrolls.
{
  const b = await box();
  const t0 = await time();
  const s0 = await scrollTop();
  const x = xAt(b, 0.4);
  await touch('touchStart', x, b.mid);
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', x + Math.round(i * 0.8), b.mid - i * 8);
    await sleep(20);
  }
  await touch('touchEnd');
  await sleep(400);
  const t1 = await time();
  check('touch: vertical swipe leaves the time', t0 === t1, `time ${t0 === t1 ? 'held' : 'changed'}, panel scroll ${s0} → ${await scrollTop()}`);
}

await tab.eval(`(() => { document.querySelector('${SEL}').scrollIntoView({ block: 'center' }); return 1; })()`);
await sleep(300);
{
  const b = await box();
  const h0 = await hm();
  await touch('touchStart', xAt(b, 0.3), b.mid);
  await sleep(60);
  await touch('touchEnd');
  await sleep(300);
  const h1 = await hm();
  const x1 = await cursorX();
  check('touch: tap sets the time', h0 !== h1 && Math.abs(x1 - xAt(b, 0.3)) <= 3, `${h0} → ${h1}, cursor x ${x1} (tap ${xAt(b, 0.3)})`);

  // Under the slop nothing moves yet; past it the drag scrubs.
  const x0 = xAt(b, 0.3);
  await touch('touchStart', x0, b.mid);
  await touch('touchMove', x0 + 4, b.mid);
  await sleep(100);
  const hs = await hm();
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', x0 + 4 + Math.round(((xAt(b, 0.7) - x0 - 4) * i) / 8), b.mid + (i % 2));
    await sleep(20);
  }
  await sleep(200);
  const h2 = await hm();
  const x2 = await cursorX();
  await touch('touchEnd');
  await sleep(200);
  check('touch: 4 px wobble does not scrub', hs === h1, `${h1} → ${hs}`);
  check('touch: sideways drag scrubs', h2 !== h1 && x2 > x1 && Math.abs(x2 - xAt(b, 0.7)) <= 3, `${h1} → ${h2}, cursor x ${x1} → ${x2}`);
  await tab.shot(`${shots}/${tag}-touch-drag.png`);
}
await tab.send('Emulation.setTouchEmulationEnabled', { enabled: false });
process.exit(failed ? 1 : 0);
