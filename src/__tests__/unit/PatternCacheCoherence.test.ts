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

import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'fs';
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
    // The write has to fail at the FILESYSTEM, after the name has been
    // accepted — that is the only path on which a cache entry could be
    // written for a file that does not exist.
    //
    // This used to force it with a 255-character name, which reached
    // `fs` and failed ENAMETOOLONG. #471 moved that rejection forward
    // into `sanitizeFilename`, where it belongs (it is the caller's
    // input, and as an uncategorised `Error` from `fs` the envelope
    // called it `internal`), so the name no longer gets that far. A
    // directory sitting on the target path fails the rename instead,
    // which exercises the same coherence question.
    const store = new PatternStore(dir);
    const name = 'blocked-by-a-directory';
    mkdirSync(join(dir, `${name}.json`));

    await expect(store.save(name, 'never-persisted', ['t'])).rejects.toThrow();

    // The load must not conjure it out of the cache.
    expect(await store.load(name)).toBeNull();
  });

  it('refuses a name too long to write, before touching the disk', async () => {
    // 255 minus `.json` minus the atomic write's `.<16 hex>.tmp` (#471).
    const store = new PatternStore(dir);
    const tooLong = 'a'.repeat(230);

    await expect(store.save(tooLong, 'never-persisted', ['t']))
      .rejects.toThrow(/229 characters/);
    expect(existsSync(join(dir, `${tooLong}.json`))).toBe(false);
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

  it('will not follow a pre-existing path at its temp location', async () => {
    // CodeQL flagged the first version of this write: a temp name built
    // from the pid and a counter is guessable, so anyone able to write
    // into the pattern directory could plant a symlink there and
    // redirect the save. The name is random now and the write is
    // exclusive — `wx` refuses an existing path rather than following
    // it. This asserts the flag, since the randomness cannot be tested
    // by guessing.
    const { readdirSync } = await import('fs');
    const store = new PatternStore(dir);
    await store.save('victim', 'ORIGINAL', ['t']);

    // Every temp file this store writes matches this shape.
    const before = readdirSync(dir);
    await store.save('victim', 'UPDATED', ['t']);

    // The save succeeded through a fresh temp name, and left none behind.
    expect((await store.load('victim'))?.content).toBe('UPDATED');
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([]);
    expect(before.filter(f => f.endsWith('.tmp'))).toEqual([]);
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
