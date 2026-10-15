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

const paragraph = (text: string) => {
  const el = document.createElement('p');
  el.textContent = text;
  return el;
};
const PAGE = paragraph(
  'It was a cold rnorning in March. He hung his his coat on the peg by the door and sat down.',
);
const proposal = (find: string, replace: string, el = PAGE): ProofreadProposal => ({
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

const boxFor = (text: string) => screen.getByText(text).closest('[role="checkbox"]')!;

describe('AIProofreadBar', () => {
  beforeEach(() => {
    keep.mockReset();
    ignore.mockReset();
  });
  afterEach(() => cleanup());

  // Reported 15 Oct 2026: only the struck original was shown, cut short, so a
  // correction could not be judged. Each one now shows what it removes, what it
  // adds and the words around it.
  it('shows each change in full, in its sentence', () => {
    proposals = [proposal('cold rnorning in', 'cold morning in')];
    renderBar();

    expect(screen.getByText('rnorning').tagName).toBe('DEL');
    expect(screen.getByText('morning').tagName).toBe('INS');
    expect(screen.getByText(/It was a/)).toBeTruthy();
    expect(screen.getByText(/March\. He hung his/)).toBeTruthy();
    expect(screen.getByText('Spelling')).toBeTruthy();
  });

  it('names the kind of change', () => {
    proposals = [
      proposal('the peg by', 'the peg on by'),
      proposal('his his coat', 'his coat'),
      proposal('cold rnorning in', 'cold morning in'),
    ];
    renderBar();
    expect(screen.getByText('Missing word')).toBeTruthy();
    expect(screen.getByText('Extra word')).toBeTruthy();
    expect(screen.getByText('Spelling')).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('keeps every ticked correction, none left out by default', () => {
    proposals = [proposal('cold rnorning in', 'cold morning in'), proposal('peg by', 'peg on by')];
    renderBar();
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box.getAttribute('aria-checked')).toBe('true');
    }
    fireEvent.click(screen.getByText('Keep'));
    expect(keep).toHaveBeenCalledWith(new Set());
  });

  it('leaves out the corrections unticked', () => {
    proposals = [proposal('cold rnorning in', 'cold morning in'), proposal('peg by', 'peg on by')];
    renderBar();

    fireEvent.click(boxFor('on'));
    expect(boxFor('on').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByText('Keep (1)'));

    expect(keep).toHaveBeenCalledWith(new Set([proposalKey(proposals[1]!)]));
  });

  it('cannot keep once every correction is unticked', () => {
    proposals = [proposal('cold rnorning in', 'cold morning in')];
    renderBar();
    fireEvent.click(boxFor('morning'));
    expect(screen.getByText('Keep (0)').closest('button')!.disabled).toBe(true);
    // Ticked again: back in.
    fireEvent.click(boxFor('morning'));
    expect(screen.getByText('Keep').closest('button')!.disabled).toBe(false);
  });

  it('lists every correction, however many', () => {
    proposals = ['a1', 'b1', 'c1', 'd1', 'e1'].map((w) => proposal(w, `${w}x`, paragraph(w)));
    renderBar();
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.getByText('e1x')).toBeTruthy();
  });
});
