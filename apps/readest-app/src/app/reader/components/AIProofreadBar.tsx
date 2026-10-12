import React, { RefObject } from 'react';
import { Insets } from '@/types/misc';
import { FoliateView } from '@/types/view';
import { useTranslation } from '@/hooks/useTranslation';
import { useAIProofread } from '../hooks/useAIProofread';

// How many corrections are listed before the rest is summed up.
const LISTED = 3;

/** The minimal question asked after the AI proofread the page: keep its corrections or not. */
const AIProofreadBar: React.FC<{
  bookKey: string;
  viewRef: RefObject<FoliateView | null>;
  gridInsets: Insets;
}> = ({ bookKey, viewRef, gridInsets }) => {
  const _ = useTranslation();
  const { proposals, keep, ignore, turnOff } = useAIProofread(bookKey, viewRef);
  if (!proposals.length) return null;

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
        <div className='mb-1 font-medium'>{_('AI proofreading')}</div>
        <ul className='mb-2 space-y-0.5'>
          {proposals.slice(0, LISTED).map((p) => (
            <li key={`${p.hash}-${p.find}`} className='truncate'>
              <span className='line-through opacity-60'>{p.find}</span>
              {' → '}
              <span className='font-medium'>{p.replace || '∅'}</span>
            </li>
          ))}
          {proposals.length > LISTED && (
            <li className='opacity-60'>
              {_('+{{count}} more', { count: proposals.length - LISTED })}
            </li>
          )}
        </ul>
        <div className='flex items-center gap-2'>
          <button type='button' className='btn btn-primary btn-sm' onClick={() => void keep()}>
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
