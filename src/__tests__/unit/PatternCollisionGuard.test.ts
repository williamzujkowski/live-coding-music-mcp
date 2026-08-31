/**
 * A save must not silently destroy a differently-named pattern (#428).
 *
 * `sanitizeFilename` is many-to-one and stays that way — names with
 * spaces and capitals are natural for music, and rejecting them would
 * break every pattern already on disk. What changes is that the
 * collision is no longer silent. Measured before the guard:
 *
 *     save("My-Jam", "VERSION-ONE"); save("my-jam", "VERSION-TWO")
 *     -> one file, VERSION-ONE gone, both saves reported success
 *
 * Policy chosen by consensus vote, unanimous: refuse with a validation
 * error naming the pattern in the way, and require an explicit
 * `overwrite` for the destructive case. Every voter attached the same
 * condition — a re-save under the SAME original name is an update, not
 * a collision — and the third test here is that condition.
 */

import { mkdtempSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PatternStore } from '../../PatternStore';
import { ValidationError } from '../../utils/CategorisedError';

describe('save refuses to overwrite a different pattern (#428)', () => {
  let dir: string;
  let store: PatternStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pattern-collision-'));
    store = new PatternStore(dir);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it.each([
    ['My-Jam', 'my-jam'],
    ['Track 1', 'TRACK 1'],
    ['Track 1', 'Track#1'],
    ['drums/kick', 'synth/kick'],
    ['日本', '中国'],
  ])('refuses %s then %s', async (first, second) => {
    await store.save(first, 'VERSION-ONE', ['t']);

    await expect(store.save(second, 'VERSION-TWO', ['t'])).rejects.toThrow(ValidationError);
    // The first pattern is still there, which is the whole point.
    expect((await store.load(first))?.content).toBe('VERSION-ONE');
  });

  it('names the pattern in the way, so the caller can act', async () => {
    // A refusal an agent cannot act on produces a retry loop.
    await store.save('My-Jam', 'VERSION-ONE', ['t']);

    await expect(store.save('my-jam', 'VERSION-TWO', ['t']))
      .rejects.toThrow(/"My-Jam"/);
    await expect(store.save('my-jam', 'VERSION-TWO', ['t']))
      .rejects.toThrow(/overwrite/);
  });

  it('a re-save under the same name is an update, not a collision', async () => {
    // Every voter flagged this: refusing it would break every edit of an
    // existing pattern.
    await store.save('My-Jam', 'VERSION-ONE', ['t']);
    await store.save('My-Jam', 'EDITED', ['t']);

    expect((await store.load('My-Jam'))?.content).toBe('EDITED');
    expect(readdirSync(dir)).toEqual(['my-jam.json']);
  });

  it('overwrite: true replaces it deliberately', async () => {
    await store.save('My-Jam', 'VERSION-ONE', ['t']);
    await store.save('my-jam', 'VERSION-TWO', ['t'], { overwrite: true });

    expect((await store.load('my-jam'))?.content).toBe('VERSION-TWO');
  });

  it('an unreadable file does not block saving over it', async () => {
    // Refusing because something in the directory cannot be parsed would
    // let one corrupt file block writes — the mistake #426 fixed for
    // reads, in the other direction.
    const { writeFileSync } = await import('fs');
    writeFileSync(join(dir, 'broken.json'), '{"name": "x", "trunc');

    await expect(store.save('broken', 'fresh', ['t'])).resolves.toBeUndefined();
    expect((await store.load('broken'))?.content).toBe('fresh');
  });

  it('distinct names that do not collide are unaffected', async () => {
    await store.save('alpha', 'A', ['t']);
    await store.save('beta', 'B', ['t']);

    expect((await store.load('alpha'))?.content).toBe('A');
    expect((await store.load('beta'))?.content).toBe('B');
  });
});
