/**
 * Tests for the MCP resources module (#131).
 *
 * Calls readResource directly with a stub PatternStore and the bundled
 * examples directory. The protocol-level wiring (capability advertisement,
 * ListResourcesRequestSchema / ReadResourceRequestSchema handlers in
 * server.ts) is exercised by the existing MCP integration tests.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isResourceUri, readResource, resources } from '../../server/resources';

const demoPatterns = [
  {
    name: 'demo',
    content: 's("bd hh sd hh")',
    tags: ['demo'],
    timestamp: '2026-01-01T00:00:00.000Z',
  },
];

const stubStore = {
  list: async () => demoPatterns,
  // The resource reads this now, so it can report files it could not
  // read the way `pattern_store` already does (#442). Deferring to the
  // same data keeps the two answers from disagreeing.
  listDetailed: async () => ({ patterns: demoPatterns, skipped: 0 }),
} as any;

const ctx = {
  store: stubStore,
  examplesDir: join(__dirname, '..', '..', '..', 'patterns', 'examples'),
};

describe('MCP resources', () => {
  it('advertises exactly four resources', () => {
    expect(resources).toHaveLength(4);
    const uris = resources.map(r => r.uri);
    expect(uris).toEqual(
      expect.arrayContaining([
        'strudel://examples',
        'strudel://patterns',
        'strudel://styles',
        'strudel://docs/tools',
      ]),
    );
  });

  it('every resource declares JSON mime type', () => {
    for (const r of resources) {
      expect(r.mimeType).toBe('application/json');
    }
  });

  it('isResourceUri recognises advertised URIs and rejects others', () => {
    expect(isResourceUri('strudel://examples')).toBe(true);
    expect(isResourceUri('strudel://unknown')).toBe(false);
    expect(isResourceUri('http://example.com')).toBe(false);
  });

  describe('strudel://examples', () => {
    it('returns the bundled example catalog', async () => {
      const result = await readResource('strudel://examples', ctx);
      expect(result.uri).toBe('strudel://examples');
      expect(result.mimeType).toBe('application/json');
      const data = JSON.parse(result.text);
      expect(data.count).toBeGreaterThan(0);
      expect(Array.isArray(data.examples)).toBe(true);
      const first = data.examples[0];
      expect(first).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          genre: expect.any(String),
        }),
      );
    });

    it('sorts examples by genre then name', async () => {
      const result = await readResource('strudel://examples', ctx);
      const data = JSON.parse(result.text);
      const sorted = [...data.examples].sort(
        (a: any, b: any) => a.genre.localeCompare(b.genre) || a.name.localeCompare(b.name),
      );
      expect(data.examples).toEqual(sorted);
    });
  });

  describe('strudel://patterns', () => {
    it('returns saved patterns from the store with content preview', async () => {
      const result = await readResource('strudel://patterns', ctx);
      const data = JSON.parse(result.text);
      expect(data.count).toBe(1);
      expect(data.patterns[0]).toEqual(
        expect.objectContaining({
          name: 'demo',
          tags: ['demo'],
          contentPreview: 's("bd hh sd hh")',
        }),
      );
    });

    it('truncates long pattern bodies in the preview', async () => {
      const longContent = 'x'.repeat(500);
      const ctxLong = {
        ...ctx,
        store: {
          list: async () => [
            { name: 'long', content: longContent, tags: [], timestamp: '' },
          ],
          listDetailed: async () => ({
            patterns: [{ name: 'long', content: longContent, tags: [], timestamp: '' }],
            skipped: 0,
          }),
        } as any,
      };
      const result = await readResource('strudel://patterns', ctxLong);
      const data = JSON.parse(result.text);
      expect(data.patterns[0].contentPreview).toHaveLength(203); // 200 chars + '...'
      expect(data.patterns[0].contentPreview.endsWith('...')).toBe(true);
    });
  });

  describe('strudel://styles', () => {
    it('returns supported styles with default BPMs', async () => {
      const result = await readResource('strudel://styles', ctx);
      const data = JSON.parse(result.text);
      expect(data.count).toBeGreaterThanOrEqual(15);
      const techno = data.styles.find((s: any) => s.name === 'techno');
      expect(techno).toEqual({ name: 'techno', defaultBpm: 130 });
      const dnb = data.styles.find((s: any) => s.name === 'dnb');
      expect(dnb).toEqual({ name: 'dnb', defaultBpm: 174 });
    });

    it('sorts styles alphabetically', async () => {
      const result = await readResource('strudel://styles', ctx);
      const data = JSON.parse(result.text);
      const names = data.styles.map((s: any) => s.name);
      expect(names).toEqual([...names].sort());
    });
  });

  describe('strudel://docs/tools', () => {
    it('returns every registered tool with a description', async () => {
      const result = await readResource('strudel://docs/tools', ctx);
      const data = JSON.parse(result.text);
      // Derived, not hardcoded: this used to assert a literal and broke
      // every time a tool landed, which teaches people to bump the number
      // rather than check the resource is right. Same drift problem as
      // #246, one layer down.
      const moduleToolCount = readdirSync(join(__dirname, '..', '..', 'server', 'tools'))
        .filter(f => f.endsWith('.ts') && f !== 'types.ts')
        .reduce((total, file) => {
          const src = readFileSync(join(__dirname, '..', '..', 'server', 'tools', file), 'utf-8');
          return total + [...src.matchAll(/^\s{4}name: '([a-z_]+)',$/gm)].length;
        }, 0);

      // + 1 for `init`, which server.ts defines inline rather than in a module.
      expect(data.count).toBe(moduleToolCount + 1);
      expect(data.count).toBeGreaterThan(20);
      const initTool = data.tools.find((t: any) => t.name === 'init');
      expect(initTool).toBeDefined();
      const compose = data.tools.find((t: any) => t.name === 'compose');
      expect(compose?.description).toContain('Generate, write, and play');
    });

    it('includes the four previously orphan local-engine tools', async () => {
      const result = await readResource('strudel://docs/tools', ctx);
      const data = JSON.parse(result.text);
      const names = data.tools.map((t: any) => t.name);
      expect(names).toEqual(expect.arrayContaining([
        'validate_pattern_local',
        'analyze_pattern_local',
        'query_pattern_events',
        'transpile_pattern',
      ]));
    });
  });

  it('throws on unknown URI', async () => {
    await expect(readResource('strudel://nope', ctx)).rejects.toThrow(/Unknown resource URI/);
  });
});
