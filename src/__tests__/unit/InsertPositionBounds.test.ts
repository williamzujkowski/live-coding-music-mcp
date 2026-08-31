/**
 * `edit_pattern mode=insert` disagreed with the controller it mirrors
 * (#442).
 *
 * `validatePositiveInteger` rejected 0 while the `splice` beneath it is
 * 0-indexed — so inserting at the TOP of a pattern was impossible — and
 * the upper end was unguarded, so `position: 9999` on a three-line
 * pattern silently appended.
 *
 * `StrudelController.insertAtLine` does the same job and documents the
 * parameter as 0-indexed, permits 0, and throws above `lines.length`.
 * Two ways of doing one thing, disagreeing about both ends.
 */

import { execute } from '../../server/tools/editor';
import type { ToolContext } from '../../server/tools/types';

function makeCtx(pattern = 'line1\nline2\nline3') {
  let written = '';
  const ctx = {
    isInitialized: () => true,
    getCurrentPatternSafe: async () => pattern,
    writePatternSafe: async (p: string) => { written = p; return 'ok'; },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  } as unknown as ToolContext;
  return { ctx, written: () => written };
}

describe('insert position matches insertAtLine (#442)', () => {
  it('0 inserts at the top, which was impossible', async () => {
    const { ctx, written } = makeCtx();

    await execute('edit_pattern', { mode: 'insert', position: 0, code: 'NEW' }, ctx);

    expect(written()).toBe('NEW\nline1\nline2\nline3');
  });

  it('the line count appends', async () => {
    const { ctx, written } = makeCtx();

    await execute('edit_pattern', { mode: 'insert', position: 3, code: 'NEW' }, ctx);

    expect(written()).toBe('line1\nline2\nline3\nNEW');
  });

  it.each([4, 9999, -1, 1.5])('refuses %p rather than silently appending', async position => {
    // `splice` clamps out-of-range indices, so these used to succeed and
    // put the code somewhere the caller did not ask for.
    const { ctx, written } = makeCtx();

    await expect(execute('edit_pattern', { mode: 'insert', position, code: 'NEW' }, ctx))
      .rejects.toThrow(/Invalid position/);
    expect(written()).toBe('');
  });

  it('a middle position is unchanged', async () => {
    // The behaviour callers already rely on must not move.
    const { ctx, written } = makeCtx();

    await execute('edit_pattern', { mode: 'insert', position: 1, code: 'NEW' }, ctx);

    expect(written()).toBe('line1\nNEW\nline2\nline3');
  });
});
