import type { Pt } from './longPress';

export interface MenuItem {
  label: string;
  detail?: string;
  run(): void;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const MARGIN_PX = 4;

/** Top-left for a menu of `w`×`h` at `at`: flipped to the pointer's other side when it would overflow, then clamped inside `b`. */
export function placeMenu(at: Pt, w: number, h: number, b: Box, m = MARGIN_PX): Pt {
  const axis = (p: number, size: number, lo: number, hi: number) => {
    const v = p + size > hi - m ? p - size : p;
    return Math.max(lo + m, Math.min(v, hi - m - size));
  };
  return { x: axis(at.x, w, b.left, b.right), y: axis(at.y, h, b.top, b.bottom) };
}

/** Eats the click that ends a press dismissing a popup, so it does not also act on the map. */
export function swallowClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    done();
  };
  // Registered mid-dispatch, so the press that called this does not trigger it.
  const done = () => {
    window.removeEventListener('click', stop, true);
    window.removeEventListener('pointerdown', done, true);
  };
  window.addEventListener('click', stop, true);
  window.addEventListener('pointerdown', done, true);
}

/** A right-click / long-press menu over the map container; listens to the window only while open. */
export class MapMenu {
  private el: HTMLDivElement | null = null;

  constructor(
    private container: HTMLElement,
    /** Presses here are map presses: dismissing with one must not also click the map. */
    private mapEl: HTMLElement
  ) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  /** `at` is in container pixels. */
  open(at: Pt, items: MenuItem[]) {
    this.close();
    const el = document.createElement('div');
    el.className = 'map-menu';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', 'Map');
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.tabIndex = -1;
      b.textContent = it.label;
      if (it.detail) {
        const d = document.createElement('span');
        d.className = 'detail';
        d.textContent = it.detail;
        b.append(d);
      }
      b.addEventListener('click', () => {
        this.close();
        it.run();
      });
      el.append(b);
    }
    el.addEventListener('keydown', this.onMenuKey);
    this.container.append(el);
    const r = this.container.getBoundingClientRect();
    const bounds = { left: Math.max(0, -r.left), top: Math.max(0, -r.top), right: Math.min(r.width, innerWidth - r.left), bottom: Math.min(r.height, innerHeight - r.top) };
    const p = placeMenu(at, el.offsetWidth, el.offsetHeight, bounds);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    this.el = el;
    window.addEventListener('pointerdown', this.onOutside, true);
    window.addEventListener('keydown', this.onEscape, true);
    (el.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true });
  }

  close() {
    if (!this.el) return;
    const hadFocus = this.el.contains(document.activeElement);
    this.el.remove();
    this.el = null;
    window.removeEventListener('pointerdown', this.onOutside, true);
    window.removeEventListener('keydown', this.onEscape, true);
    if (hadFocus) this.mapEl.querySelector<HTMLElement>('canvas')?.focus({ preventScroll: true });
  }

  private onOutside = (e: PointerEvent) => {
    if (!this.el || (e.target instanceof Node && this.el.contains(e.target))) return;
    this.close();
    if (e.target instanceof Node && this.mapEl.contains(e.target)) swallowClick();
  };

  private onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    this.close();
  };

  private onMenuKey = (e: KeyboardEvent) => {
    // Enter here picks an item; it must not also reach the window's map shortcuts.
    e.stopPropagation();
    const items = [...(this.el?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined) {
      if (e.key === 'Tab') {
        e.preventDefault();
        this.close();
      }
      return;
    }
    e.preventDefault();
    items[(next + items.length) % items.length].focus({ preventScroll: true });
  };
}
