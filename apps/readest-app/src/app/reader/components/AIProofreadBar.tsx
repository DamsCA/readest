import React, { RefObject, useEffect, useState } from 'react';
import { Insets } from '@/types/misc';
import { FoliateView } from '@/types/view';
import { useTranslation } from '@/hooks/useTranslation';
import { proposalKey, useAIProofread } from '../hooks/useAIProofread';

// How many corrections are listed before the rest is summed up.
const LISTED = 3;

/**
 * The minimal question asked after the page was proofread: keep the
 * corrections or not. Tapping one leaves it out; the others are kept.
 */
const AIProofreadBar: React.FC<{
  bookKey: string;
  viewRef: RefObject<FoliateView | null>;
  gridInsets: Insets;
}> = ({ bookKey, viewRef, gridInsets }) => {
  const _ = useTranslation();
  const { proposals, keep, ignore, turnOff } = useAIProofread(bookKey, viewRef);
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setLeftOut(new Set());
    setExpanded(false);
  }, [proposals]);

  if (!proposals.length) return null;

  const toggle = (key: string) =>
    setLeftOut((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const listed = expanded ? proposals : proposals.slice(0, LISTED);
  const allLeftOut = proposals.every((p) => leftOut.has(proposalKey(p)));

  return (
    <div
      className='pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4'
      style={{ bottom: gridInsets.bottom + 64 }}
    >
      <div
        role='dialog'
        aria-label={_('AI proofreading')}
        className='bg-base-200 text-base-content pointer-events-auto w-full max-w-md rounded-xl p-3 text-sm shadow-lg'
      >
        <div className='mb-1 flex items-baseline gap-2'>
          <span className='font-medium'>{_('AI proofreading')}</span>
          {proposals.length > 1 && (
            <span className='truncate text-xs opacity-60'>
              {_('Tap a correction to leave it out')}
            </span>
          )}
        </div>
        <ul className='mb-2 max-h-48 space-y-0.5 overflow-y-auto'>
          {listed.map((p) => {
            const key = proposalKey(p);
            const out = leftOut.has(key);
            return (
              <li key={key}>
                <button
                  type='button'
                  aria-pressed={!out}
                  className={`w-full truncate text-start ${out ? 'opacity-40' : ''}`}
                  onClick={() => toggle(key)}
                >
                  <span className='line-through opacity-60'>{p.find}</span>
                  {' → '}
                  <span className={out ? 'line-through' : 'font-medium'}>{p.replace || '∅'}</span>
                </button>
              </li>
            );
          })}
          {!expanded && proposals.length > LISTED && (
            <li>
              <button
                type='button'
                className='text-start opacity-60'
                onClick={() => setExpanded(true)}
              >
                {_('+{{count}} more', { count: proposals.length - LISTED })}
              </button>
            </li>
          )}
        </ul>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            disabled={allLeftOut}
            onClick={() => void keep(leftOut)}
          >
            {_('Keep')}
          </button>
          <button type='button' className='btn btn-ghost btn-sm' onClick={ignore}>
            {_('Ignore')}
          </button>
          <button
            type='button'
            className='btn btn-link btn-xs ml-auto opacity-60'
            onClick={turnOff}
          >
            {_('Turn off for this book')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIProofreadBar;
