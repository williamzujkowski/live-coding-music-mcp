/**
 * The skipped count belongs to the listing that produced it.
 *
 * `listDetailed` used to read `this.skippedInLastRead` after awaiting
 * `list`, which wrote it — while the docstring directly above it
 * disclaimed that design: "a `getLastSkipped()` would belong to
 * whichever listing finished most recently, and two concurrent calls
 * would cross their answers."
 *
 * MEASURED, and worth stating plainly: I could not make two concurrent
 * listings produce a wrong count. The skipped count is a property of
 * the directory, not of the tag filter, so concurrent listings compute
 * the same value and crossing them is unobservable unless files change
 * mid-flight. This is a fix for shared mutable state that made an
 * invariant unenforceable, not for a reproducible failure — and the
 * comment claiming the state was not shared is what needed correcting
 * most (#473).
 *
 * These are behaviour guards over the reworked read path.
 */
import { promises as fs, mkdtempSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { PatternStore } from '../../PatternStore';
import { BusinessError } from '../../utils/CategorisedError';

describe('listDetailed skipped count', () => {
  const withStore = async (): Promise<{ dir: string; store: PatternStore }> => {
    const dir = mkdtempSync(join(tmpdir(), 'store-count-'));
    const store = new PatternStore(dir);
    await store.save('kept', 's("bd")', ['keep']);
    for (const n of ['bad1', 'bad2', 'bad3']) {
      await fs.writeFile(join(dir, `${n}.json`), '{"nonsense": 1}');
    }
    return { dir, store };
  };

  it('reports the same count for a tagged and an untagged listing', async () => {
    const { store } = await withStore();
    const [tagged, all] = await Promise.all([
      store.listDetailed('keep'),
      store.listDetailed(),
    ]);
    expect(tagged.skipped).toBe(3);
    expect(all.skipped).toBe(3);
    expect(tagged.patterns.map(p => p.name)).toEqual(['kept']);
    expect(all.patterns.map(p => p.name)).toEqual(['kept']);
  });

  it('a cache hit carries the cached count, not zero', async () => {
    const { store } = await withStore();
    expect((await store.listDetailed()).skipped).toBe(3);
    expect((await store.listDetailed()).skipped).toBe(3); // inside the 5s TTL
  });

  it('a tag filter does not hide unreadable files', async () => {
    const { store } = await withStore();
    const none = await store.listDetailed('no-such-tag');
    expect(none.patterns).toEqual([]);
    // Nothing matched, but three files still could not be read, and a
    // caller told "no patterns" deserves to know why (#426).
    expect(none.skipped).toBe(3);
  });

  it('reports zero when every file reads cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-count-'));
    const store = new PatternStore(dir);
    await store.save('a', 's("bd")');
    expect((await store.listDetailed()).skipped).toBe(0);
  });

  it('reports an unreadable directory instead of calling it empty', async () => {
    // Individual bad files are counted in `skipped`; this catch only
    // fires when the whole directory is unavailable. It used to return
    // {"patterns":[],"skipped":0} — telling the caller they have no
    // saved patterns when the truth is nothing could be looked at,
    // which is #426's lie down a different path.
    const locked = mkdtempSync(join(tmpdir(), 'store-locked-'));
    chmodSync(locked, 0o000);
    try {
      await expect(new PatternStore(locked).listDetailed())
        .rejects.toThrow(BusinessError);
    } finally {
      chmodSync(locked, 0o700);
    }
  });
});

describe('saved tags are copied, not aliased', () => {
  it('does not let the caller mutate a saved pattern after the fact', async () => {
    // The caller's array was stored by reference and cached, so
    // mutating it changed what `load` returned while the file kept the
    // original — cache and disk disagreeing, the thing #428 prevents.
    const dir = mkdtempSync(join(tmpdir(), 'store-tags-'));
    const store = new PatternStore(dir);

    const tags = ['x'];
    await store.save('p', 'code', tags);
    tags[0] = 'y';

    expect((await store.load('p'))?.tags).toEqual(['x']);
    const onDisk = JSON.parse(await fs.readFile(join(dir, 'p.json'), 'utf-8'));
    expect(onDisk.tags).toEqual(['x']);
  });
});
