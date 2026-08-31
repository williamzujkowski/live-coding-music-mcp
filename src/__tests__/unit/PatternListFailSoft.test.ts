/**
 * One bad file must not hide every good one (#426).
 *
 * `list()` used `Promise.all`, which is fail-fast: a single truncated or
 * unparseable `.json` rejected the batch, the catch returned `[]`, and
 * `doList` reported that as the success "No patterns found". Measured
 * before the fix — five saved patterns plus one truncated file:
 *
 *     saved 5, list -> 5
 *     after one truncated file, fresh store list -> 0
 *
 * A hundred patterns and one bad file told the user they had none, with
 * `ok: true`. Same family as #277, #288, #293 and #335; here the failure
 * is not merely unreported, it is reported as its opposite.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PatternStore } from '../../PatternStore';

describe('a listing survives files it cannot read (#426)', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pattern-store-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  async function withPatterns(count: number): Promise<PatternStore> {
    const store = new PatternStore(dir);
    for (let i = 0; i < count; i++) {
      await store.save(`pattern-${String(i)}`, 's("bd*4")', ['drums']);
    }
    return store;
  }

  it('lists the good files beside a truncated one', async () => {
    await withPatterns(5);
    writeFileSync(join(dir, 'truncated.json'), '{"name": "broken", "conte');

    // A fresh store, so nothing is served from cache.
    const store = new PatternStore(dir);
    const { patterns, skipped } = await store.listDetailed();

    expect(patterns).toHaveLength(5);
    expect(skipped).toBe(1);
  });

  it('lists the good files beside one that parses but is not a pattern', async () => {
    // `JSON.parse(...) as PatternData` is a cast, not a check: this file
    // used to throw in the sort (no `timestamp`) or the tag filter (no
    // `tags`), taking the whole listing with it.
    await withPatterns(3);
    writeFileSync(join(dir, 'noshape.json'), '{"name":"x","content":"y"}');

    const store = new PatternStore(dir);

    const { patterns, skipped } = await store.listDetailed();
    expect(patterns).toHaveLength(3);
    expect(skipped).toBe(1);
  });

  it('a tag filter still works with a bad file present', async () => {
    await withPatterns(4);
    writeFileSync(join(dir, 'truncated.json'), 'not json at all');

    const store = new PatternStore(dir);

    expect(await store.list('drums')).toHaveLength(4);
    expect(await store.list('nonexistent')).toHaveLength(0);
  });

  it('an empty directory is still empty, not an error', async () => {
    // #288: valid-empty is not failure, and this fix must not blur them.
    const store = new PatternStore(dir);

    const { patterns, skipped } = await store.listDetailed();
    expect(patterns).toEqual([]);
    expect(skipped).toBe(0);
  });

  it('reports nothing skipped when every file is fine', async () => {
    const store = await withPatterns(2);
    const fresh = new PatternStore(dir);

    const { patterns, skipped } = await fresh.listDetailed();
    expect(patterns).toHaveLength(2);
    expect(skipped).toBe(0);
    expect(await store.list()).toHaveLength(2);
  });
});
