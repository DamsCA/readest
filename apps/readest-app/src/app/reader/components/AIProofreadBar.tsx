import clsx from 'clsx';
import React, { RefObject, useEffect, useState } from 'react';
import { Insets } from '@/types/misc';
import { FoliateView } from '@/types/view';
import { useTranslation } from '@/hooks/useTranslation';
import { paragraphText } from '@/utils/aiProofreadDom';
import { CorrectionKind, contextAround, correctionKind, wordDiff } from '@/utils/wordDiff';
import { ProofreadProposal, proposalKey, useAIProofread } from '../hooks/useAIProofread';

/** One proposal as the reader judges it: what kind of change, in its sentence. */
const Change: React.FC<{ proposal: ProofreadProposal; label: string }> = ({ proposal, label }) => {
  const parts = wordDiff(proposal.find, proposal.replace);
  const { before, after, cutBefore, cutAfter } = contextAround(
    paragraphText(proposal.el),
    proposal.find,
  );
  return (
    <span className='min-w-0 flex-1'>
      <span className='block text-xs opacity-60'>{label}</span>
      <span className='block break-words leading-snug'>
        {before && (
          <span className='opacity-60'>
            {cutBefore && '…'}
            {before}{' '}
          </span>
        )}
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            {i > 0 && ' '}
            {part.kind === 'del' ? (
              <del className='text-error'>{part.text}</del>
            ) : part.kind === 'add' ? (
              <ins className='text-success font-semibold no-underline'>{part.text}</ins>
            ) : (
              <span>{part.text}</span>
            )}
          </React.Fragment>
        ))}
        {after && (
          <span className='opacity-60'>
            {' '}
            {after}
            {cutAfter && '…'}
          </span>
        )}
      </span>
    </span>
  );
};

/**
 * The question asked after the page was proofread. Each proposal shows what it
 * changes in its sentence (removed words struck in red, added words in green)
 * with a box to untick; the ticked ones are kept.
 */
const AIProofreadBar: React.FC<{
  bookKey: string;
  viewRef: RefObject<FoliateView | null>;
  gridInsets: Insets;
}> = ({ bookKey, viewRef, gridInsets }) => {
  const _ = useTranslation();
  const { proposals, keep, ignore, turnOff } = useAIProofread(bookKey, viewRef);
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setLeftOut(new Set());
  }, [proposals]);

  if (!proposals.length) return null;

  const kindLabels: Record<CorrectionKind, string> = {
    added: _('Missing word'),
    removed: _('Extra word'),
    spelling: _('Spelling'),
    spacing: _('Spacing or punctuation'),
    changed: _('Rewording'),
  };
  const toggle = (key: string) =>
    setLeftOut((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const ticked = proposals.filter((p) => !leftOut.has(proposalKey(p))).length;

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
        <div className='mb-2'>
          <div className='font-medium'>{_('AI proofreading')}</div>
          <div className='text-xs opacity-60'>{_('Untick what looks wrong, then keep')}</div>
        </div>
        <ul className='mb-3 max-h-64 space-y-3 overflow-y-auto'>
          {proposals.map((p) => {
            const key = proposalKey(p);
            const out = leftOut.has(key);
            return (
              <li key={key}>
                <button
                  type='button'
                  role='checkbox'
                  aria-checked={!out}
                  className={clsx('flex w-full items-start gap-2 text-start', out && 'opacity-50')}
                  onClick={() => toggle(key)}
                >
                  <span
                    aria-hidden='true'
                    className={clsx(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none',
                      out
                        ? 'border-base-content/40'
                        : 'border-primary bg-primary text-primary-content',
                    )}
                  >
                    {out ? '' : '✓'}
                  </span>
                  <Change proposal={p} label={kindLabels[correctionKind(p.find, p.replace)]} />
                </button>
              </li>
            );
          })}
        </ul>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            disabled={ticked === 0}
            onClick={() => void keep(leftOut)}
          >
            {ticked === proposals.length ? _('Keep') : _('Keep ({{count}})', { count: ticked })}
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
