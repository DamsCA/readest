// @vitest-environment node
import { describe, it, expect } from 'vitest';

// TTSController imports these statically, and Next prerenders the reader page
// in Node, where no DOM global exists. A DOM global touched at module load
// ("ReferenceError: NodeFilter is not defined") failed the release build.
// jsdom-based tests cannot see that, so check module evaluation without a DOM.
describe('TTS helpers load without a DOM (Next prerender)', () => {
  it('has no DOM in this environment', () => {
    expect(typeof globalThis.NodeFilter).toBe('undefined');
  });

  it('ttsTextWalker evaluates without touching the DOM', async () => {
    await expect(import('@/utils/ttsTextWalker')).resolves.toBeDefined();
  });

  it('translationDom evaluates without touching the DOM', async () => {
    await expect(import('@/utils/translationDom')).resolves.toBeDefined();
  });
});
