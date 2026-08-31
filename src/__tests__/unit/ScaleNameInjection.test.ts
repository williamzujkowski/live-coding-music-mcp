/**
 * `transform op=scale` interpolates its argument into pattern source
 * (#440).
 *
 * It only checked the length. Measured before the fix:
 *
 *     transform({op:'scale', root:'C', scale:'minor") .gain(9) //'})
 *     wrote: s("bd*4").scale("C:minor") .gain(9) //")
 *
 * The appended `.gain(9)` is exactly what `PatternValidator`'s
 * dangerous-gain rule exists to block — and it slips past because that
 * rule runs on the pattern BEFORE this is concatenated onto it.
 *
 * `opEffectAdd`, twenty lines below, validates its effect name for this
 * reason with a comment citing #236. `validateScaleName` already existed
 * and `generate.ts` already used it. This path never did.
 */

import { execute } from '../../server/tools/transform';
import type { ToolContext } from '../../server/tools/types';

function makeCtx() {
  let written = '';
  const ctx = {
    isInitialized: () => true,
    getCurrentPatternSafe: async () => 's("bd*4")',
    writePatternSafe: async (p: string) => { written = p; return 'ok'; },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  } as unknown as ToolContext;
  return { ctx, written: () => written };
}

describe('transform op=scale refuses code in a scale name (#440)', () => {
  it.each([
    ['minor") .gain(9) //', 'closes the string and appends a call'],
    ['majo"r', 'a bare quote'],
    ['minor; hush()', 'a statement separator'],
    ['minor").stop() //', 'a transport call'],
  ])('refuses %p — %s', async (scale) => {
    const { ctx, written } = makeCtx();

    await expect(execute('transform', { op: 'scale', root: 'C', scale }, ctx))
      .rejects.toThrow(/Invalid scale name/);
    expect(written()).toBe('');
  });

  it('still applies a real scale', async () => {
    const { ctx, written } = makeCtx();

    await execute('transform', { op: 'scale', root: 'C', scale: 'minor' }, ctx);

    expect(written()).toBe('s("bd*4").scale("C:minor")');
  });

  it('accepts every scale the generator accepts', async () => {
    // The validator is shared with `generate.ts`, so restricting this
    // path cannot reject a scale the rest of the server offers.
    for (const scale of ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian']) {
      const { ctx, written } = makeCtx();
      await execute('transform', { op: 'scale', root: 'C', scale }, ctx);
      expect(written()).toContain(`.scale("C:${scale}")`);
    }
  });
});
