/**
 * `load` validates what it reads, and the name limit is the real one.
 *
 * Two defects, both #471:
 *
 *  - `load` parsed the JSON and returned it. `listDetailed` and
 *    `readIfPresent` both run `asPatternData`; `load` never got the
 *    #426 hardening, so the two disagreed about the same file — the
 *    listing skipped it as malformed while `load` handed it back.
 *  - `sanitizeFilename` allowed 255 characters, but the atomic write
 *    needs `<name>.json.<16 hex>.tmp` to fit in a 255-byte component,
 *    so anything over 229 failed as a raw ENAMETOOLONG from `fs` —
 *    an uncategorised Error, so the envelope called it `internal`.
 */
import { promises as fs } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { PatternStore } from '../../PatternStore';
import { ValidationError } from '../../utils/CategorisedError';

describe('PatternStore.load validation', () => {
  let dir: string;
  let store: PatternStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'store-load-'));
    store = new PatternStore(dir);
  });

  it.each([
    ['an object that is not a pattern', '{"nonsense": 1}'],
    ['an array', '[1,2,3]'],
    ['a bare null', 'null'],
    ['a bare string', '"just a string"'],
  ])('returns null for %s', async (_label, contents) => {
    await fs.writeFile(join(dir, 'thing.json'), contents);
    expect(await store.load('thing')).toBeNull();
  });

  it('agrees with listDetailed about the same file', async () => {
    await fs.writeFile(join(dir, 'thing.json'), '{"nonsense": 1}');
    const listed = await store.listDetailed();
    expect(listed.skipped).toBe(1);
    expect(listed.patterns).toEqual([]);
    // The listing calling it malformed while `load` served it was the
    // whole defect.
    expect(await store.load('thing')).toBeNull();
  });

  it('still loads a real pattern', async () => {
    await store.save('real', 's("bd")');
    expect((await store.load('real'))?.content).toBe('s("bd")');
  });
});

describe('PatternStore name length', () => {
  let store: PatternStore;

  beforeEach(() => {
    store = new PatternStore(mkdtempSync(join(tmpdir(), 'store-name-')));
  });

  it('saves a name at the ceiling', async () => {
    await expect(store.save('a'.repeat(229), 's("bd")')).resolves.not.toThrow();
  });

  it('refuses one over it as validation, not as an internal error', async () => {
    // It used to reach `fs` and come back ENAMETOOLONG — an
    // uncategorised Error, which the envelope reports as `internal` and
    // not retryable, for what is plainly the caller's input.
    await expect(store.save('a'.repeat(230), 's("bd")')).rejects.toThrow(ValidationError);
    await expect(store.save('a'.repeat(230), 's("bd")')).rejects.toThrow(/229 characters/);
  });
});
