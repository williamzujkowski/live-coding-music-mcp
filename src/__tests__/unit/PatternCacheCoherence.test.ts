/**
 * The cache must answer for the same file the disk does (#428).
 *
 * `patternCache` was keyed by the caller's raw name while the file is
 * keyed by the sanitized one, so two names that sanitize alike had one
 * file and two cache entries. Measured before the fix:
 *
 *     save("My-Jam", "VERSION-ONE"); save("my-jam", "VERSION-TWO")
 *     files on disk: ["my-jam.json"]   disk content: VERSION-TWO
 *     load("My-Jam") -> VERSION-ONE    load("my-jam") -> VERSION-TWO
 *
 * Two answers for one file, and the stale one never expired — this cache
 * has no TTL.
 *
 * Separately, the cache was written BEFORE the file, so a rejected write
 * left a pattern cached that was never persisted.
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PatternStore } from '../../PatternStore';

describe('the cache and the disk agree (#428)', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pattern-cache-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const onDisk = (file: string): string =>
    JSON.parse(readFileSync(join(dir, file), 'utf-8')).content;

  it('two spellings of one filename read the same content', async () => {
    const store = new PatternStore(dir);
    await store.save('My-Jam', 'VERSION-ONE', ['t']);
    // Deliberate now: the collision itself is refused unless asked for
    // (#428, and PatternCollisionGuard.test.ts covers the refusal). The
    // property under test here is that the cache does not then disagree
    // with the file about what survived.
    await store.save('my-jam', 'VERSION-TWO', ['t'], { overwrite: true });

    // Whatever the collision policy ends up being, the cache must not
    // disagree with the file about what is in it.
    expect(onDisk('my-jam.json')).toBe('VERSION-TWO');
    expect((await store.load('my-jam'))?.content).toBe('VERSION-TWO');
    expect((await store.load('My-Jam'))?.content).toBe('VERSION-TWO');
  });

  it.each([
    ['Track 1', 'track_1'],
    ['TRACK 1', 'track_1'],
    ['Track#1', 'track_1'],
  ])('%s reads back what its file holds', async (name, file) => {
    const store = new PatternStore(dir);
    await store.save(name, `content-of-${file}`, ['t']);

    expect((await store.load(name))?.content).toBe(onDisk(`${file}.json`));
  });

  it('does not cache a pattern whose write failed', async () => {
    // A 255-character name passes InputValidator's limit and
    // `sanitizeFilename`, which measures the stem without `.json` — and
    // then fails ENAMETOOLONG on the 260-byte component.
    const store = new PatternStore(dir);
    const tooLong = 'a'.repeat(255);

    await expect(store.save(tooLong, 'never-persisted', ['t'])).rejects.toThrow();

    expect(existsSync(join(dir, `${tooLong}.json`))).toBe(false);
    // The load must not conjure it out of the cache.
    expect(await store.load(tooLong)).toBeNull();
  });

  it('a normal save/load round trip still works', async () => {
    const store = new PatternStore(dir);
    await store.save('plain-name', 's("bd*4")', ['drums']);

    expect((await store.load('plain-name'))?.content).toBe('s("bd*4")');
  });
});

/**
 * A save is atomic (#428 item 6).
 *
 * The write went straight to the final path, so a crash or a full disk
 * left truncated JSON behind — exactly the input that used to take the
 * entire listing down (#426). That fix made the listing survive such a
 * file; this one stops producing them.
 */
describe('a save leaves no half-written file (#428)', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pattern-atomic-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('leaves no temp file behind after concurrent saves', async () => {
    const { readdirSync } = await import('fs');
    const store = new PatternStore(dir);

    await Promise.all([
      store.save('a', 'A', ['t']),
      store.save('b', 'B', ['t']),
      store.save('c', 'C', ['t']),
    ]);

    const files = readdirSync(dir).sort();
    expect(files).toEqual(['a.json', 'b.json', 'c.json']);
    // A stray .tmp would become the next listing's problem.
    expect(files.every(f => f.endsWith('.json'))).toBe(true);
  });

  it('cleans up the temp file when the rename fails', async () => {
    const { readdirSync } = await import('fs');
    const store = new PatternStore(dir);
    // A name that sanitizes to something writable but whose final path
    // is a directory — rename onto it fails.
    const { mkdirSync } = await import('fs');
    mkdirSync(join(dir, 'blocked.json'));

    await expect(store.save('blocked', 'content', ['t'])).rejects.toThrow();

    expect(readdirSync(dir).filter(f => f.includes('.tmp'))).toEqual([]);
  });
});
