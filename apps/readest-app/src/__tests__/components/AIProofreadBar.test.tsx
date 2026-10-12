import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProofreadProposal } from '@/app/reader/hooks/useAIProofread';

const keep = vi.fn();
const ignore = vi.fn();
const turnOff = vi.fn();
let proposals: ProofreadProposal[] = [];
// The real module pulls in the stores; the bar only needs these two.
vi.mock('@/app/reader/hooks/useAIProofread', () => ({
  proposalKey: (p: ProofreadProposal) => `${p.hash}|${p.find}|${p.replace}`,
  useAIProofread: () => ({ proposals, keep, ignore, turnOff }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, o?: { count?: number }) =>
    s.replace('{{count}}', String(o?.count ?? '')),
}));

import AIProofreadBar from '@/app/reader/components/AIProofreadBar';
import { proposalKey } from '@/app/reader/hooks/useAIProofread';

const el = document.createElement('p');
const proposal = (find: string, replace: string): ProofreadProposal => ({
  find,
  replace,
  hash: 'h1',
  el,
});

const renderBar = () =>
  render(
    <AIProofreadBar
      bookKey='book1-view1'
      viewRef={{ current: null }}
      gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
    />,
  );

describe('AIProofreadBar', () => {
  beforeEach(() => {
    keep.mockReset();
    ignore.mockReset();
  });
  afterEach(() => cleanup());

  it('keeps everything but the corrections tapped out', () => {
    proposals = [proposal('rnorning', 'morning'), proposal('the peg by', 'the peg on by')];
    renderBar();

    fireEvent.click(screen.getByText('the peg on by'));
    fireEvent.click(screen.getByText('Keep'));

    expect(keep).toHaveBeenCalledWith(new Set([proposalKey(proposals[1]!)]));
  });

  it('cannot keep once every correction is left out', () => {
    proposals = [proposal('rnorning', 'morning')];
    renderBar();
    fireEvent.click(screen.getByText('morning'));
    expect(screen.getByText('Keep').closest('button')!.disabled).toBe(true);
    // Tapped again: back in.
    fireEvent.click(screen.getByText('morning'));
    expect(screen.getByText('Keep').closest('button')!.disabled).toBe(false);
  });

  it('lists three corrections, the rest on demand', () => {
    proposals = ['a1', 'b1', 'c1', 'd1', 'e1'].map((w) => proposal(w, `${w}x`));
    renderBar();
    expect(screen.queryByText('d1x')).toBeNull();

    fireEvent.click(screen.getByText('+2 more'));
    expect(screen.getByText('d1x')).toBeTruthy();
    expect(screen.getByText('e1x')).toBeTruthy();
  });
});
