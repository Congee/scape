import { describe, expect, it } from 'vitest';
import { SearchAction, searchKey, searchStatus } from './searchKeys';

const open = (active: number) => ({ open: true, active });

describe('search keys', () => {
  it('moves down and up, wrapping at the ends', () => {
    expect(searchKey(open(-1), 'ArrowDown', false, 3).active).toBe(0);
    expect(searchKey(open(0), 'ArrowDown', false, 3).active).toBe(1);
    expect(searchKey(open(2), 'ArrowDown', false, 3).active).toBe(0);
    expect(searchKey(open(0), 'ArrowUp', false, 3).active).toBe(2);
    expect(searchKey(open(-1), 'ArrowUp', false, 3).active).toBe(2);
  });

  it('opens a closed list from its start', () => {
    expect(searchKey({ open: false, active: 2 }, 'ArrowDown', false, 3)).toMatchObject({ open: true, active: 0, handled: true });
  });

  it('picks the highlighted result, else the first', () => {
    expect(searchKey(open(1), 'Enter', false, 3)).toMatchObject({ action: SearchAction.Pick, index: 1, open: false, handled: true });
    expect(searchKey(open(-1), 'Enter', false, 3)).toMatchObject({ action: SearchAction.Pick, index: 0 });
    expect(searchKey({ open: false, active: 1 }, 'Enter', false, 3).index).toBe(0);
    expect(searchKey(open(1), 'Enter', true, 3)).toMatchObject({ action: SearchAction.Target, index: 1 });
  });

  it('does nothing on Enter with no results', () => {
    expect(searchKey(open(-1), 'Enter', false, 0)).toMatchObject({ action: SearchAction.None, handled: false });
  });

  it('closes on Escape, and leaves an already closed list to the browser', () => {
    expect(searchKey(open(1), 'Escape', false, 3)).toMatchObject({ open: false, active: -1, handled: true });
    expect(searchKey({ open: false, active: -1 }, 'Escape', false, 3).handled).toBe(false);
  });

  it('ignores other keys', () => {
    expect(searchKey(open(1), 'a', false, 3)).toMatchObject({ open: true, active: 1, handled: false });
  });
});

describe('search status', () => {
  it('says searching, then no matches, and nothing once there are results', () => {
    expect(searchStatus({ text: 'zz', coord: false, searching: true, count: 0 })).toBe('Searching…');
    expect(searchStatus({ text: 'zz', coord: false, searching: false, count: 0 })).toBe('No places');
    expect(searchStatus({ text: 'zz', coord: false, searching: false, count: 2 })).toBeNull();
  });

  it('stays quiet for one letter and for coordinates', () => {
    expect(searchStatus({ text: 'z', coord: false, searching: false, count: 0 })).toBeNull();
    expect(searchStatus({ text: '45 7', coord: true, searching: false, count: 1 })).toBeNull();
  });
});
