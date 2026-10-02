// Pans the map by a real mouse drag and zooms it by wheel, in the tab already on the origin.
/* oxlint-disable no-await-in-loop -- input steps run one after another */
// Usage: bun scripts/smoke/mapdrag.ts <cdp> <origin>
import { Tab } from './cdp';

const [cdp = '9479', origin = 'http://localhost:5479'] = process.argv.slice(2);
const tab = await Tab.open(Number(cdp), origin);
const r = await tab.eval<{ x: number; y: number }>('(() => { const r = document.querySelector(".maplibregl-canvas").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 3), y: Math.round(r.top + r.height / 3) }; })()');
const mouse = (type: string, x: number, y: number, buttons: number) => tab.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: 1 });
await mouse('mouseMoved', r.x, r.y, 0);
await mouse('mousePressed', r.x, r.y, 1);
for (let i = 1; i <= 10; i++) {
  await mouse('mouseMoved', r.x + i * 20, r.y + i * 10, 1);
  await Bun.sleep(16);
}
await mouse('mouseReleased', r.x + 200, r.y + 100, 0);
await Bun.sleep(300);
for (let i = 0; i < 4; i++) {
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r.x + 200, y: r.y + 100, deltaX: 0, deltaY: -240 });
  await Bun.sleep(60);
}
process.exit(0);
