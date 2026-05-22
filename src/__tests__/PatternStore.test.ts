import { PatternStore } from '../PatternStore';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

describe('PatternStore', () => {
  let store: PatternStore;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing. fs.mkdtemp atomically creates
    // a uniquely-named directory with an unpredictable random suffix and 0700
    // permissions, so there is no predictable path an attacker could
    // pre-create or symlink (unlike tmpdir()+Date.now()).
    testDir = await fs.mkdtemp(path.join(tmpdir(), 'strudel-test-'));
    store = new PatternStore(testDir);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('save', () => {
    test('should save a pattern successfully', async () => {
      const name = 'test-pattern';
      const content = 's("bd*4")';
      const tags = ['techno', 'test'];

      await store.save(name, content, tags);

      const files = await fs.readdir(testDir);
      expect(files).toContain('test-pattern.json');
    });

    test('should sanitize filename', async () => {
      const name = 'Test Pattern With Spaces!@#';
      const content = 's("bd*4")';

      await store.save(name, content);

      const files = await fs.readdir(testDir);
      expect(files).toContain('test_pattern_with_spaces___.json');
    });

    test('should save pattern with timestamp', async () => {
      const name = 'timestamped';
      const content = 's("bd*4")';

      await store.save(name, content);

      const pattern = await store.load(name);
      expect(pattern).not.toBeNull();
      expect(pattern!.timestamp).toBeDefined();
      expect(new Date(pattern!.timestamp).getTime()).toBeGreaterThan(0);
    });

    test('should overwrite existing pattern', async () => {
      const name = 'overwrite-test';

      await store.save(name, 's("bd*4")');
      await store.save(name, 's("cp*4")');

      const pattern = await store.load(name);
      expect(pattern!.content).toBe('s("cp*4")');
    });
  });

  describe('load', () => {
    test('should load an existing pattern', async () => {
      const name = 'loadable';
      const content = 's("bd*4, cp*2")';
      const tags = ['house'];

      await store.save(name, content, tags);
      const loaded = await store.load(name);

      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe(name);
      expect(loaded!.content).toBe(content);
      expect(loaded!.tags).toEqual(tags);
    });

    test('should return null for non-existent pattern', async () => {
      const loaded = await store.load('does-not-exist');
      expect(loaded).toBeNull();
    });

    test('should handle sanitized filenames when loading', async () => {
      const name = 'Pattern With Spaces';
      const content = 's("bd*4")';

      await store.save(name, content);
      const loaded = await store.load(name);

      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe(name);
    });
  });

  describe('list', () => {
    test('should list all patterns', async () => {
      await store.save('pattern1', 's("bd*4")', ['techno']);
      await store.save('pattern2', 's("cp*4")', ['house']);
      await store.save('pattern3', 's("hh*8")', ['dnb']);

      const patterns = await store.list();

      expect(patterns).toHaveLength(3);
      expect(patterns.map(p => p.name).sort()).toEqual(['pattern1', 'pattern2', 'pattern3']);
    });

    test('should filter patterns by tag', async () => {
      await store.save('pattern1', 's("bd*4")', ['techno', 'dark']);
      await store.save('pattern2', 's("cp*4")', ['house']);
      await store.save('pattern3', 's("hh*8")', ['techno']);

      const technoPatterns = await store.list('techno');

      expect(technoPatterns).toHaveLength(2);
      expect(technoPatterns.map(p => p.name).sort()).toEqual(['pattern1', 'pattern3']);
    });

    test('should return patterns sorted by timestamp (newest first)', async () => {
      await store.save('old', 's("bd*4")');
      await new Promise(resolve => setTimeout(resolve, 10));
      await store.save('middle', 's("cp*4")');
      await new Promise(resolve => setTimeout(resolve, 10));
      await store.save('new', 's("hh*8")');

      const patterns = await store.list();

      expect(patterns[0].name).toBe('new');
      expect(patterns[1].name).toBe('middle');
      expect(patterns[2].name).toBe('old');
    });

    test('should return empty array for empty directory', async () => {
      const patterns = await store.list();
      expect(patterns).toEqual([]);
    });

    test('should ignore non-JSON files', async () => {
      await store.save('valid', 's("bd*4")');
      await fs.writeFile(path.join(testDir, 'invalid.txt'), 'not json');

      const patterns = await store.list();

      expect(patterns).toHaveLength(1);
      expect(patterns[0].name).toBe('valid');
    });
  });

  describe('edge cases', () => {
    test('should handle patterns with special characters in content', async () => {
      const name = 'special';
      const content = 's("bd*4").room(0.9)\n// Comment with "quotes"';

      await store.save(name, content);
      const loaded = await store.load(name);

      expect(loaded!.content).toBe(content);
    });

    test('should handle very long pattern names', async () => {
      const name = 'a'.repeat(200);
      const content = 's("bd*4")';

      await store.save(name, content);
      const loaded = await store.load(name);

      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe(name);
    });

    test('should handle empty tags array', async () => {
      const name = 'no-tags';
      const content = 's("bd*4")';

      await store.save(name, content, []);
      const loaded = await store.load(name);

      expect(loaded!.tags).toEqual([]);
    });

    test('should handle unicode characters in names', async () => {
      const name = 'パターン-テスト';
      const content = 's("bd*4")';

      await store.save(name, content);
      const loaded = await store.load(name);

      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe(name);
    });
  });
});
