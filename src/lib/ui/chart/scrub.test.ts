import { describe, expect, it } from 'vitest';
import { clampTime, HOUR_MS, keyStep, MINUTE_MS, timeAtX, TouchGesture, touchGesture, xAtTime } from './scrub';

const START = Date.UTC(2026, 5, 21);
const END = START + 24 * HOUR_MS;

describe('timeAtX', () => {
  it('maps x linearly across the span', () => {
    expect(timeAtX(0, 300, START, END)).toBe(START);
    expect(timeAtX(150, 300, START, END)).toBe(START + 12 * HOUR_MS);
    expect(timeAtX(75, 300, START, END)).toBe(START + 6 * HOUR_MS);
  });

  it('lands on a whole minute', () => {
    const t = timeAtX(100.3, 300, START, END);
    expect(t % MINUTE_MS).toBe(0);
    expect(Math.abs(t - (START + (100.3 / 300) * 24 * HOUR_MS))).toBeLessThanOrEqual(MINUTE_MS / 2);
  });

  it('clamps outside the chart, keeping the end on the same day', () => {
    expect(timeAtX(-40, 300, START, END)).toBe(START);
    expect(timeAtX(300, 300, START, END)).toBe(END - MINUTE_MS);
    expect(timeAtX(900, 300, START, END)).toBe(END - MINUTE_MS);
  });

  it('survives an empty span or width', () => {
    expect(timeAtX(10, 0, START, END)).toBe(START);
    expect(timeAtX(10, 300, START, START)).toBe(START);
  });

  it('inverts xAtTime', () => {
    for (const h of [0, 3, 11.5, 23]) {
      const t = START + h * HOUR_MS;
      expect(timeAtX(xAtTime(t, 300, START, END), 300, START, END)).toBe(t);
    }
  });
});

describe('xAtTime', () => {
  it('maps the span onto the width', () => {
    expect(xAtTime(START, 300, START, END)).toBe(0);
    expect(xAtTime(START + 6 * HOUR_MS, 300, START, END)).toBe(75);
    expect(xAtTime(END, 300, START, END)).toBe(300);
    expect(xAtTime(START, 300, START, START)).toBe(0);
  });
});

describe('clampTime', () => {
  it('keeps times inside [start, end)', () => {
    expect(clampTime(START - 1, START, END)).toBe(START);
    expect(clampTime(START + HOUR_MS, START, END)).toBe(START + HOUR_MS);
    expect(clampTime(END, START, END)).toBe(END - MINUTE_MS);
    expect(clampTime(END + 5, START, START)).toBe(START);
  });
});

describe('keyStep', () => {
  it('steps an hour, ten minutes with Shift', () => {
    expect(keyStep('ArrowRight', false)).toBe(HOUR_MS);
    expect(keyStep('ArrowLeft', false)).toBe(-HOUR_MS);
    expect(keyStep('ArrowRight', true)).toBe(10 * MINUTE_MS);
    expect(keyStep('ArrowLeft', true)).toBe(-10 * MINUTE_MS);
  });

  it('takes the chart own steps and ignores other keys', () => {
    expect(keyStep('ArrowRight', false, 30 * MINUTE_MS, MINUTE_MS)).toBe(30 * MINUTE_MS);
    expect(keyStep('ArrowUp', false)).toBe(0);
    expect(keyStep('Enter', true)).toBe(0);
  });
});

describe('touchGesture', () => {
  it('stays pending, a tap, under the slop', () => {
    expect(touchGesture(0, 0)).toBe(TouchGesture.Pending);
    expect(touchGesture(5, -5)).toBe(TouchGesture.Pending);
  });

  it('scrubs once it moves sideways past the slop', () => {
    expect(touchGesture(6, 2)).toBe(TouchGesture.Scrub);
    expect(touchGesture(-9, 8)).toBe(TouchGesture.Scrub);
  });

  it('scrolls when it moves mostly vertically', () => {
    expect(touchGesture(2, 6)).toBe(TouchGesture.Scroll);
    expect(touchGesture(7, -7)).toBe(TouchGesture.Scroll);
    expect(touchGesture(3, 1, 2)).toBe(TouchGesture.Scrub);
  });
});
