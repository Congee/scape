export interface ListState {
  open: boolean;
  /** Highlighted result, -1 for none. */
  active: number;
}

export const SearchAction = { None: 'None', Pick: 'Pick', Target: 'Target' } as const;
export type SearchAction = (typeof SearchAction)[keyof typeof SearchAction];

export interface KeyResult extends ListState {
  action: SearchAction;
  /** Result the action applies to. */
  index: number;
  /** Whether the key was used, so the browser default is suppressed. */
  handled: boolean;
}

/** Combobox keys: ↑/↓ move and wrap, Enter picks (the first result when none is highlighted), Shift+Enter targets, Esc closes. */
export function searchKey(s: ListState, key: string, shift: boolean, count: number): KeyResult {
  const same = { ...s, action: SearchAction.None, index: -1, handled: false };
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      if (!count) return { ...same, open: true, active: -1, handled: true };
      const down = key === 'ArrowDown';
      // A closed list opens at its start (↓) or end (↑).
      const from = s.open ? s.active : -1;
      const active = from < 0 ? (down ? 0 : count - 1) : (from + (down ? 1 : count - 1)) % count;
      return { ...same, open: true, active, handled: true };
    }
    case 'Enter': {
      if (!count) return same;
      const index = s.open && s.active >= 0 && s.active < count ? s.active : 0;
      return { open: false, active: -1, action: shift ? SearchAction.Target : SearchAction.Pick, index, handled: true };
    }
    case 'Escape':
      return s.open ? { ...same, open: false, active: -1, handled: true } : same;
    default:
      return same;
  }
}

/** What the list says about itself; null while there is nothing to say. */
export function searchStatus(s: { text: string; coord: boolean; searching: boolean; count: number }): string | null {
  if (s.coord) return null;
  if (s.text.length < 2) return null;
  if (s.searching) return 'Searching…';
  return s.count ? null : 'No matches';
}
