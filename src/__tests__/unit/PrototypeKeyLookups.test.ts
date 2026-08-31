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
  const RISKY = /\b[A-Z][A-Z0-9_]{2,}\s*\[[^\]]+\]\s*(\|\||\?\?)/;

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
      readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
        if (RISKY.test(line) && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')) {
          offenders.push(`${file.split('/src/')[1]}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the scan actually matches the shape it is looking for', () => {
    // A guard that cannot fail is not a guard.
    expect(RISKY.test("  const x = CHORD_INTERVALS[chordType.toLowerCase()] || CHORD_INTERVALS[''];")).toBe(true);
    expect(RISKY.test('  const t = TEMPO_BY_STYLE[resolved] ?? 120;')).toBe(true);
    expect(RISKY.test('  const a = arr[i] || 0;')).toBe(false);
  });
});
