/**
 * Three findings from a correctness sweep (#341).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { calculateComplexity, extractBpm } from '../../services/StrudelEngineHelpers';
import { readResource } from '../../server/resources';
import { TEMPO_BY_STYLE, DRUM_STYLES } from '../../services/StyleRegistry';

describe('calculateComplexity does not saturate on length alone (#341)', () => {
  const lengthOnly = (codeLength: number) =>
    calculateComplexity({ codeLength, functionsUsed: [], isStack: false });

  it('a long but simple pattern is not maximally complex', () => {
    // `codeLength / 500` was uncapped while the other four factors were
    // all Math.min(..., 1), so anything past ~1700 characters pinned
    // the score to 1.0 regardless of content.
    expect(lengthOnly(7200)).toBeLessThan(0.5);
  });

  it('length still discriminates across the real corpus range', () => {
    // The shipped examples span 388 to 7216 characters. Capping at 500
    // would make 800 and 7200 identical, which is the opposite failure.
    expect(lengthOnly(1600)).toBeGreaterThan(lengthOnly(400));
    expect(lengthOnly(400)).toBeGreaterThan(lengthOnly(200));
  });

  it('a genuinely dense pattern still scores high', () => {
    // Capping length must not make high scores unreachable.
    const dense = calculateComplexity({
      codeLength: 3200,
      functionsUsed: ['s', 'note', 'fast', 'rev', 'room', 'gain', 'lpf', 'every'],
      isStack: true,
      eventsPerCycle: 32,
    });
    expect(dense).toBeGreaterThan(0.8);
  });

  it('no shipped example scores exactly 1.0', () => {
    // 8 of 18 did. An 18x length difference was indistinguishable.
    const dir = join(__dirname, '..', '..', '..', 'patterns', 'examples');
    const scores: number[] = [];
    for (const genre of readdirSync(dir)) {
      const genreDir = join(dir, genre);
      if (!statSync(genreDir).isDirectory()) continue;
      for (const file of readdirSync(genreDir).filter(f => f.endsWith('.json'))) {
        const pattern = (JSON.parse(
          readFileSync(join(genreDir, file), 'utf-8')) as { pattern: string }).pattern;
        scores.push(calculateComplexity({
          codeLength: pattern.length,
          functionsUsed: [],
          isStack: pattern.includes('stack'),
        }));
      }
    }
    expect(scores.length).toBeGreaterThan(10);
    expect(scores.filter(s => s >= 1)).toHaveLength(0);
  });
});

describe('extractBpm reads the forms the examples use (#341)', () => {
  it.each([
    ['setcpm(130)', 130],
    ['setcpm( 174 )', 174],
    ['setcpm(130/4)', 130],   // two shipped longform examples use this
    ['setcpm(174/4)', 174],
    ['setCpm(120)', 120],     // case
    ['setcpm(120.5)', 120.5],
  ])('%s -> %p', (code, expected) => {
    expect(extractBpm(code)).toBe(expected);
  });

  it('returns undefined when there is no tempo', () => {
    expect(extractBpm('s("bd*4")')).toBeUndefined();
  });

  it('the shipped longform examples now report a BPM', () => {
    // Both declare a bpm in their metadata and write setcpm(bpm/4);
    // extractBpm returned undefined for both.
    const dir = join(__dirname, '..', '..', '..', 'patterns', 'examples', 'longform');
    for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as
        { pattern: string; bpm?: number };
      if (!/setcpm/i.test(parsed.pattern)) continue;
      expect(extractBpm(parsed.pattern)).toBeDefined();
    }
  });
});

describe('strudel://styles is not a stale hand-maintained copy (#341)', () => {
  it('lists every style the registry knows', async () => {
    // It omitted intelligent_dnb, trip_hop and boom_bap — the only three
    // genres with BOTH dedicated drums and a dedicated bassline — plus
    // acid, dub and funk. An agent using this for discovery would never
    // find trip_hop.
    const resource = await readResource('strudel://styles', {} as never) as { text: string };
    const payload = JSON.parse(resource.text) as { styles: { name: string }[] };
    const listed = payload.styles.map(s => s.name);

    for (const style of Object.keys(TEMPO_BY_STYLE)) {
      expect(listed).toContain(style);
    }
  });

  it('lists every style that has dedicated drums', async () => {
    const resource = await readResource('strudel://styles', {} as never) as { text: string };
    const text = resource.text;
    for (const style of DRUM_STYLES) {
      expect(text).toContain(style);
    }
  });
});
