/**
 * Caller-controlled keys must not reach a plain object's prototype (#308).
 *
 * `TABLE[key]` on an object literal returns an inherited value for
 * 'constructor', '__proto__', 'toString' and friends. Those values are
 * truthy, so the usual `|| fallback` and `if (!x)` guards never fire and
 * the inherited value flows on as if it were data.
 *
 * This is the fifth and sixth instance found in this codebase — the
 * others were StyleRegistry.resolveDrumStyle, three sites in
 * PatternGenerator, and defaultTempoFor (#295, #296). Found one at a
 * time, so this file also carries a source scan for the shape.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { execute as transformExecute } from '../../server/tools/transform';
import { MIDIExportService } from '../../services/MIDIExportService';
import type { ToolContext } from '../../server/tools/types';

const PROTOTYPE_KEYS = ['constructor', '__proto__', 'prototype', 'toString', 'valueOf'];

function makeCtx() {
  let current = 's("bd*4")';
  const ctx = {
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    isInitialized: () => true,
    getController: () => ({ play: jest.fn() }),
    getCurrentPatternSafe: async () => current,
    writePatternSafe: async (p: string) => { current = p; return 'written'; },
  } as unknown as ToolContext;
  return { ctx, pattern: () => current };
}

describe('shape dimension=mood (#308)', () => {
  it.each(PROTOTYPE_KEYS)('rejects %s like any other unknown mood', async mood => {
    const { ctx } = makeCtx();
    const r = await transformExecute(
      'shape', { dimension: 'mood', target_mood: mood, auto_play: false }, ctx) as any;
    expect(r.success).toBe(false);
    expect(r.error).toContain(`Unknown mood: ${mood}`);
  });

  it('does not write a NaN-riddled pattern into the editor', async () => {
    // MOOD_PROFILES['constructor'] returned Object — truthy — so the
    // `if (!profile)` guard passed and the result was
    // s("bd*4").slow(NaN).lpf(NaN).room(NaN).gain(NaN), reported as
    // success:true.
    const { ctx, pattern } = makeCtx();
    const before = pattern();
    const r = await transformExecute(
      'shape', { dimension: 'mood', target_mood: 'constructor', auto_play: false }, ctx) as any;
    expect(r.success).toBe(false);
    expect(pattern()).toBe(before);
    expect(pattern()).not.toContain('NaN');
  });

  it('a real mood still works', async () => {
    const { ctx, pattern } = makeCtx();
    const r = await transformExecute(
      'shape', { dimension: 'mood', target_mood: 'dark', auto_play: false }, ctx) as any;
    expect(r.success).toBe(true);
    expect(pattern()).not.toContain('NaN');
  });
});

describe('export_midi chord types (#308)', () => {
  const svc = new MIDIExportService();

  it.each(PROTOTYPE_KEYS)('C%s does not fail the whole export', suffix => {
    // CHORD_INTERVALS['constructor'] inherits Object, so `intervals.map`
    // threw a TypeError that took the valid Am down with it.
    const r = svc.exportToBase64(`chord("C${suffix} Am")`) as any;
    expect(r.success).toBe(true);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('an unknown suffix behaves the same as a prototype key', () => {
    const wibble = svc.exportToBase64('chord("Cwibble Am")') as any;
    const proto = svc.exportToBase64('chord("Cconstructor Am")') as any;
    // Both fall back to the default triad. The point is consistency: a
    // prototype key must not be a special case.
    expect(wibble.success).toBe(proto.success);
    expect(wibble.noteCount).toBe(proto.noteCount);
  });

  it('a real chord is unaffected', () => {
    const r = svc.exportToBase64('chord("Cmaj7 Am")') as any;
    expect(r.success).toBe(true);
    expect(r.noteCount).toBeGreaterThan(0);
  });
});

describe('source scan: no table lookup falls back with || or ?? (#308)', () => {
  /**
   * The exact shape of every instance found so far:
   *
   *     const x = TABLE[callerControlledKey] || FALLBACK;
   *     const x = TABLE[callerControlledKey] ?? fallback;
   *
   * Neither operator fires for an inherited value, because inherited
   * values are neither falsy nor nullish. `Object.hasOwn` is the fix.
   */
  //
  // The first version of this scan only matched UPPER_SNAKE table names.
  // It therefore missed `chordMap[chord] || key`, `this.scales[name]`
  // and `this.chordProgressions[style]` — three more instances found by
  // an accuracy review two hours later (#318). Widened to any
  // identifier, including `this.x`, followed by a fallback operator.
  const RISKY = /(\bthis\.)?\b[A-Za-z_$][A-Za-z0-9_$]*\s*\[[^\]]+\]\s*(\|\||\?\?)\s*[^=]/;

  /**
   * Indexed reads with no fallback at all, which throw a raw TypeError
   * on an inherited value rather than returning it. Narrower, because
   * `arr[i]` is everywhere: only `this.<table>[<non-literal>]`.
   */
  // `this.table[name]` where `name` is a word, excluding the usual
  // numeric loop indices — `arr[i]`, `arr[idx]`, `arr[step]` and the
  // like are not this bug, and flagging them would bury the real hits.
  const NUMERIC_INDEX = /^(i|j|k|n|x|y|idx|index|step|bin|tonic|pos|offset)$/;
  const RISKY_BARE = /\bthis\.[A-Za-z_$][A-Za-z0-9_$]*\s*\[\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\]/;

  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== '__tests__' && entry !== '__mocks__') sourceFiles(full, acc);
      } else if (entry.endsWith('.ts')) {
        acc.push(full);
      }
    }
    return acc;
  }

  it('finds no risky lookup anywhere in src/', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(__dirname, '..', '..'))) {
      const all = readFileSync(file, 'utf-8').split('\n');
      all.forEach((line, i) => {
        const isComment = line.trimStart().startsWith('//') || line.trimStart().startsWith('*');
        // A multi-line ternary puts the guard on a neighbouring line.
        const nearby = all.slice(Math.max(0, i - 2), i + 3).join('\n');
        const guarded = nearby.includes('hasOwn') || nearby.includes('hasOwnProperty')
          || nearby.includes('lookup(');
        const fallbackHit = /([A-Za-z_$][A-Za-z0-9_$]*)\s*\[\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\]\s*(\|\||\?\?)/.exec(line);
        const fallbackIsRisky = RISKY.test(line)
          && (fallbackHit === null || !NUMERIC_INDEX.test(fallbackHit[2].split('.')[0]));
        const bare = RISKY_BARE.exec(line);
        const bareIsRisky = bare !== null && !NUMERIC_INDEX.test(bare[1].split('.')[0]);
        if (!isComment && !guarded && (fallbackIsRisky || bareIsRisky)) {
          offenders.push(`${file.split('/src/')[1]}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the scan actually matches the shapes it is looking for', () => {
    // A guard that cannot fail is not a guard.
    expect(RISKY.test("  const x = CHORD_INTERVALS[chordType.toLowerCase()] || CHORD_INTERVALS[''];")).toBe(true);
    expect(RISKY.test('  const t = TEMPO_BY_STYLE[resolved] ?? 120;')).toBe(true);
    // The three the first version of this scan missed (#318).
    expect(RISKY.test('      .map(chord => chordMap[chord] || key)')).toBe(true);
    expect(RISKY_BARE.test('    const scale = this.scales[scaleName];')).toBe(true);
    expect(RISKY_BARE.test('    const progression = this.chordProgressions[style];')).toBe(true);
    // ...without flagging an ordinary array index.
    // ...without flagging an ordinary numeric index.
    expect(NUMERIC_INDEX.test('i')).toBe(true);
    expect(NUMERIC_INDEX.test('step')).toBe(true);
    expect(NUMERIC_INDEX.test('scaleName')).toBe(false);
  });
});

/**
 * The shared helper, and the music-theory sites the widened scan found.
 */
describe('lookup() (#318)', () => {
  const { lookup, lookupOrUndefined } = require('../../utils/TableLookup');
  const table = { techno: 'a', house: 'b' };

  it('returns an own value', () => {
    expect(lookup(table, 'techno', 'fallback')).toBe('a');
  });

  it.each(['constructor', '__proto__', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'])(
    'returns the fallback for %s', key => {
      expect(lookup(table, key, 'fallback')).toBe('fallback');
    });

  it('returns the fallback for a missing key', () => {
    expect(lookup(table, 'vaporwave', 'fallback')).toBe('fallback');
  });

  it('tolerates a non-string key', () => {
    expect(lookup(table, undefined, 'fallback')).toBe('fallback');
    expect(lookup(table, null, 'fallback')).toBe('fallback');
  });

  it('lookupOrUndefined distinguishes absent from falsy', () => {
    expect(lookupOrUndefined({ a: 0 }, 'a')).toBe(0);
    expect(lookupOrUndefined({ a: 0 }, 'constructor')).toBeUndefined();
  });
});

describe('music theory survives prototype keys (#318)', () => {
  const { MusicTheory } = require('../../services/MusicTheory');
  const { PatternGenerator } = require('../../services/PatternGenerator');
  const t = new MusicTheory();
  const g = new PatternGenerator();

  it.each(['constructor', '__proto__', 'toString'])(
    'generateChordProgression rejects %s rather than throwing a TypeError', style => {
      expect(() => t.generateChordProgression('C', style))
        .toThrow(/Invalid progression style/);
    });

  it.each(['constructor', '__proto__'])(
    'generateScale rejects %s cleanly', scale => {
      expect(() => t.generateScale('C', scale)).toThrow(/Invalid scale/);
    });

  it.each(['constructor', '__proto__', 'toString'])(
    'generateFill falls back for %s', style => {
      expect(typeof g.generateFill(style, 1)).toBe('string');
    });

  it.each(['constructor', '__proto__'])(
    'generateVariation falls back for %s', kind => {
      expect(typeof g.generateVariation('s("bd*4")', kind)).toBe('string');
    });
});

describe('sharp roots produce correct intervals (#318)', () => {
  const { PatternGenerator } = require('../../services/PatternGenerator');
  const { MusicTheory } = require('../../services/MusicTheory');
  const g = new PatternGenerator();
  const t = new MusicTheory();
  const SEMITONES: Record<string, number> = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3,
    e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 };

  const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  it.each(ROOTS)('%s: getFifth agrees with MusicTheory.getNote', root => {
    // `.replace('#','b')` ran before the sharp->flat lookup, so
    // getFifth('D#') returned 'ab' (a semitone flat) and getFifth('F#')
    // returned 'F#' unchanged, while getNote had the same interval right.
    const mine = (g as unknown as { getFifth(r: string): string })['getFifth'](root);
    expect(SEMITONES[mine.toLowerCase()]).toBe(SEMITONES[t.getNote(root, 7).toLowerCase()]);
  });

  it.each(ROOTS)('%s: getMinorThird agrees with MusicTheory.getNote', root => {
    const mine = (g as unknown as { getMinorThird(r: string): string })['getMinorThird'](root);
    expect(SEMITONES[mine.toLowerCase()]).toBe(SEMITONES[t.getNote(root, 3).toLowerCase()]);
  });
});

describe('the edm progression is minor (#318)', () => {
  const { MusicTheory } = require('../../services/MusicTheory');
  const t = new MusicTheory();

  it('C minor gives Cm Ab Eb Bb, not Cm A E B', () => {
    // Uppercase VI/III/VII mean major-scale degrees in chordMap, which
    // under a minor tonic put every non-tonic chord a semitone sharp.
    // This is the progression techno uses by default.
    const chords = t.generateChordProgression('C', 'edm').split(' ');
    const semis: Record<string, number> = { 'g#': 8, ab: 8, 'd#': 3, eb: 3, 'a#': 10, bb: 10 };
    expect(chords[0]).toBe('Cm');
    expect(semis[chords[1].toLowerCase()]).toBe(8);   // bVI
    expect(semis[chords[2].toLowerCase()]).toBe(3);   // bIII
    expect(semis[chords[3].toLowerCase()]).toBe(10);  // bVII
  });

  it('A minor gives Am F C G', () => {
    expect(t.generateChordProgression('A', 'edm')).toBe('Am F C G');
  });

  it('major progressions are unchanged', () => {
    expect(t.generateChordProgression('C', 'pop')).toBe('C G Am F');
    expect(t.generateChordProgression('C', 'jazz')).toBe('Dm7 G7 Cmaj7');
  });

  it('chord case is consistent — no lowercase tonic', () => {
    expect(t.generateChordProgression('C', 'edm')).not.toContain('cm');
    expect(t.generateChordProgression('C', 'modal')).not.toContain('cm');
  });
});
