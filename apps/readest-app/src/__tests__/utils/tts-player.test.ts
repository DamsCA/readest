import { describe, it, expect } from 'vitest';
import {
  NOTCH_COUNT,
  clampRate,
  formatDuration,
  formatRate,
  notchToRate,
  rateToNotch,
  stepRate,
} from '@/utils/ttsPlayer';

// Asked 16 Oct 2026: a sensitive wheel rather than pressing plus or minus.
describe('speed wheel', () => {
  it('has one notch per hundredth, from 0.5 to 2.5', () => {
    expect(NOTCH_COUNT).toBe(201);
    expect(notchToRate(0)).toBe(0.5);
    expect(notchToRate(200)).toBe(2.5);
  });

  it('turns rates into notches and back', () => {
    expect(rateToNotch(1)).toBe(50);
    expect(rateToNotch(1.05)).toBe(55);
    expect(notchToRate(53)).toBe(1.03);
    expect(notchToRate(rateToNotch(1.07))).toBe(1.07);
  });

  it('stays on the wheel', () => {
    expect(notchToRate(-4)).toBe(0.5);
    expect(notchToRate(999)).toBe(2.5);
  });
});

// Reported 15 Oct 2026: steps of 0.1, and 1.1 too fast where 1.0 was too slow.
describe('read-aloud speed', () => {
  it('moves by 0.05, from any rate', () => {
    expect(stepRate(1, 1)).toBe(1.05);
    expect(stepRate(1.05, 1)).toBe(1.1);
    expect(stepRate(1.05, -1)).toBe(1);
    expect(stepRate(1.03, 1)).toBe(1.05);
    expect(stepRate(1.03, -1)).toBe(1);
    expect(stepRate(1.1, -1)).toBe(1.05);
  });

  it('stays within bounds, to the hundredth', () => {
    expect(stepRate(2.5, 1)).toBe(2.5);
    expect(stepRate(0.5, -1)).toBe(0.5);
    expect(clampRate(1.0749)).toBe(1.07);
    expect(clampRate(9)).toBe(2.5);
    expect(clampRate(0.1)).toBe(0.5);
  });

  it('reads like a speed in the reader’s language', () => {
    expect(formatRate(1.05, 'fr')).toBe('1,05×');
    expect(formatRate(1, 'fr')).toBe('1,0×');
    expect(formatRate(1.1, 'en')).toBe('1.1×');
  });
});

describe('remaining time', () => {
  it('reads in minutes, then hours', () => {
    expect(formatDuration(30)).toBe('< 1 min');
    expect(formatDuration(45 * 60)).toBe('45 min');
    expect(formatDuration(80 * 60)).toBe('1 h 20');
    expect(formatDuration(65 * 60)).toBe('1 h 05');
    expect(formatDuration(120 * 60)).toBe('2 h');
  });
});
