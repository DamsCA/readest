import clsx from 'clsx';
import React, { useLayoutEffect, useRef } from 'react';
import { selectionFeedback } from '@tauri-apps/plugin-haptics';
import { getLocale } from '@/utils/misc';
import { NOTCH_COUNT, notchToRate, rateToNotch, stepRate } from '@/utils/ttsPlayer';

// Width of one notch (a hundredth): wide enough that a finger stops on 1.03.
const NOTCH_PX = 12;

const tick = (notch: number) =>
  notch % 10 === 0 ? 'major' : notch % 5 === 0 ? 'mid' : ('minor' as const);

/**
 * The speed as a wheel rolled sideways, one notch per hundredth, the rate under
 * the centre line. Asked 16 Oct 2026 in place of the - and + buttons; with Fish
 * the sentence being read changes speed as the wheel turns.
 */
const SpeedWheel: React.FC<{
  value: number;
  label: string;
  haptics?: boolean;
  onChange: (rate: number) => void;
}> = ({ value, label, haptics, onChange }) => {
  const ref = useRef<HTMLDivElement>(null);
  const lastNotch = useRef(rateToNotch(value));
  const rolling = useRef(false);
  const programmatic = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef(0);

  // Follow a rate set from outside (a preset), never while the finger rolls.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || rolling.current) return;
    const notch = rateToNotch(value);
    lastNotch.current = notch;
    programmatic.current = true;
    el.scrollLeft = notch * NOTCH_PX;
    requestAnimationFrame(() => {
      programmatic.current = false;
    });
  }, [value]);

  const select = (notch: number) => {
    if (notch === lastNotch.current) return;
    lastNotch.current = notch;
    if (haptics) void selectionFeedback().catch(() => {});
    onChange(notchToRate(notch));
  };

  const handleScroll = () => {
    if (programmatic.current) return;
    rolling.current = true;
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      rolling.current = false;
    }, 250);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = ref.current;
      if (el) select(Math.round(el.scrollLeft / NOTCH_PX));
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const notch = rateToNotch(value);
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? notch + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? notch - 1
          : e.key === 'PageUp'
            ? rateToNotch(stepRate(value, 1))
            : e.key === 'PageDown'
              ? rateToNotch(stepRate(value, -1))
              : null;
    if (next === null) return;
    e.preventDefault();
    select(Math.max(0, Math.min(NOTCH_COUNT - 1, next)));
  };

  const fade = 'linear-gradient(to right, transparent, black 18%, black 82%, transparent)';
  const decimal = new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return (
    <div className='relative'>
      <div
        ref={ref}
        role='slider'
        tabIndex={0}
        aria-label={label}
        aria-valuemin={notchToRate(0)}
        aria-valuemax={notchToRate(NOTCH_COUNT - 1)}
        aria-valuenow={value}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        className='h-14 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden'
        style={{
          scrollbarWidth: 'none',
          maskImage: fade,
          WebkitMaskImage: fade,
          touchAction: 'pan-x',
        }}
      >
        <div
          className='flex h-full'
          style={{ paddingInline: `calc(50% - ${NOTCH_PX / 2}px)`, width: 'max-content' }}
        >
          {Array.from({ length: NOTCH_COUNT }, (_, notch) => {
            const kind = tick(notch);
            return (
              <div
                key={notch}
                className='relative flex h-full shrink-0 snap-center items-end justify-center'
                style={{ width: NOTCH_PX }}
              >
                {kind === 'major' && (
                  <span className='absolute top-0 text-[11px] tabular-nums opacity-70'>
                    {decimal.format(notchToRate(notch))}
                  </span>
                )}
                <span
                  className={clsx(
                    'mb-1 w-px rounded-full',
                    kind === 'major' && 'bg-base-content h-6',
                    kind === 'mid' && 'bg-base-content/60 h-4',
                    kind === 'minor' && 'bg-base-content/30 h-2.5',
                  )}
                />
              </div>
            );
          })}
        </div>
      </div>
      {/* The rate under this line is the one read. */}
      <div className='bg-primary pointer-events-none absolute bottom-0 left-1/2 h-9 w-0.5 -translate-x-1/2 rounded-full' />
    </div>
  );
};

export default SpeedWheel;
