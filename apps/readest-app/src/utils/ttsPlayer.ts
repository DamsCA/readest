// The read-aloud player's controls. The old panel moved the speed in steps of
// 0.1, and 1.1 was too fast where 1.0 was too slow (reported 15 Oct 2026).

export const MIN_RATE = 0.5;
export const MAX_RATE = 2.5;
const RATE_STEP = 0.05;

export const RATE_PRESETS = [0.8, 0.9, 1, 1.05, 1.1, 1.2, 1.3, 1.5, 2];

/** A rate within bounds, to the hundredth. */
export const clampRate = (rate: number) =>
  Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) * 100) / 100;

/** The next step of 0.05 above (dir 1) or below (dir -1), from any rate. */
export const stepRate = (rate: number, dir: 1 | -1) => {
  const steps = rate / RATE_STEP;
  const next = dir > 0 ? Math.floor(steps + 1e-6) + 1 : Math.ceil(steps - 1e-6) - 1;
  return clampRate(next * RATE_STEP);
};

// The speed wheel: one notch per hundredth, rolled with a finger ("a sensitive
// wheel rather than pressing plus or minus", asked 16 Oct 2026).
const NOTCH = 0.01;
export const NOTCH_COUNT = Math.round((MAX_RATE - MIN_RATE) / NOTCH) + 1;

/** The wheel's notch for a rate, 0 at the slowest. */
export const rateToNotch = (rate: number) => Math.round((clampRate(rate) - MIN_RATE) / NOTCH);

/** The rate at a notch of the wheel. */
export const notchToRate = (notch: number) =>
  clampRate(MIN_RATE + Math.max(0, Math.min(NOTCH_COUNT - 1, Math.round(notch))) * NOTCH);

/** "1,05×" in French, "1.05×" in English; one decimal at least ("1,0×"). */
export const formatRate = (rate: number, locale?: string) =>
  `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(rate)}×`;

/** "45 min", "1 h 20", "< 1 min". */
export const formatDuration = (seconds: number) => {
  if (seconds < 60) return '< 1 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
};

/** Sleep timer choices, in seconds (0: off). */
export const TIMER_PRESETS = [0, 600, 900, 1800, 2700, 3600, 5400, 7200];
