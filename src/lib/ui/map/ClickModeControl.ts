import type { IControl } from 'maplibre-gl';
import { ClickMode, settingsStore } from '@state/settings';
import { swallowClick } from './mapMenu';

const SVG = (body: string) => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICON: Record<ClickMode, string> = {
  [ClickMode.Camera]: SVG('<path d="M3 7.2c0-.9.7-1.6 1.6-1.6h2.2L8 4h4l1.2 1.6h2.2c.9 0 1.6.7 1.6 1.6v7.2c0 .9-.7 1.6-1.6 1.6H4.6c-.9 0-1.6-.7-1.6-1.6z"/><circle cx="10" cy="10.6" r="2.9"/>'),
  [ClickMode.Target]: SVG('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="3"/><circle cx="10" cy="10" r="0.6" fill="currentColor"/>'),
  [ClickMode.Off]: SVG('<path d="M6 3.5v11l3-2.6 2 4.4 2-.9-2-4.3h4z"/><path d="M3.5 16.5l13-13"/>')
};

const NAME: Record<ClickMode, string> = { [ClickMode.Camera]: 'Camera', [ClickMode.Target]: 'Target', [ClickMode.Off]: 'Off' };
const DOES: Record<ClickMode, string> = {
  [ClickMode.Camera]: 'A map click sets the camera',
  [ClickMode.Target]: 'A map click sets the target',
  [ClickMode.Off]: 'A map click sets nothing'
};
const SHORTCUTS = 'Shift-click sets the target, Alt-click adds a marker';

/** Picks what a plain map click sets: one button showing the mode, which opens into the three choices. */
export class ClickModeControl implements IControl {
  private el = document.createElement('div');
  private expanded = false;
  private unsub: (() => void) | null = null;

  onAdd(): HTMLElement {
    this.el.className = 'maplibregl-ctrl maplibregl-ctrl-group click-mode';
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.unsub = settingsStore.subscribe((s) => s.clickMode, () => this.render());
    this.render();
    return this.el;
  }

  onRemove() {
    this.collapse(false);
    this.unsub?.();
    this.el.remove();
  }

  private render() {
    const mode = settingsStore.getState().clickMode;
    const buttons = this.expanded
      ? Object.values(ClickMode).map((m) => this.button(m, `${NAME[m]}: ${DOES[m].toLowerCase()}. ${SHORTCUTS}.`, m === mode, () => this.choose(m)))
      : [this.button(mode, `${DOES[mode]}. ${SHORTCUTS}. Click to change.`, null, () => this.expand())];
    this.el.replaceChildren(...buttons);
    this.el.classList.toggle('open', this.expanded);
  }

  private button(m: ClickMode, title: string, pressed: boolean | null, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.mode = m;
    b.title = title;
    b.innerHTML = ICON[m];
    if (pressed === null) {
      b.setAttribute('aria-label', `Map click: ${NAME[m]}`);
      b.setAttribute('aria-haspopup', 'true');
      b.setAttribute('aria-expanded', 'false');
    } else {
      b.setAttribute('aria-label', NAME[m]);
      b.setAttribute('aria-pressed', String(pressed));
    }
    b.addEventListener('click', onClick);
    return b;
  }

  private expand() {
    this.expanded = true;
    this.render();
    this.el.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    window.addEventListener('pointerdown', this.onOutside, true);
    window.addEventListener('keydown', this.onEscape, true);
  }

  private collapse(refocus: boolean) {
    if (!this.expanded) return;
    this.expanded = false;
    window.removeEventListener('pointerdown', this.onOutside, true);
    window.removeEventListener('keydown', this.onEscape, true);
    this.render();
    if (refocus) this.el.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  private choose(m: ClickMode) {
    settingsStore.getState().update({ clickMode: m });
    this.collapse(true);
  }

  private onOutside = (e: PointerEvent) => {
    if (e.target instanceof Node && this.el.contains(e.target)) return;
    this.collapse(false);
    if (e.target instanceof Element && e.target.closest('.maplibregl-canvas-container')) swallowClick();
  };

  private onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    this.collapse(true);
  };
}
