/**
 * compose reports what each layer actually plays (#294), and style
 * lookup survives prototype keys (#295).
 *
 * #279 made compose report `resolveDrumStyle(style).resolved`. That
 * function vets DRUMS only, while the generator picks bassline, chords
 * and scale independently — so the "honest" report was wrong in both
 * directions:
 *
 *   overclaim  compose({style:'jazz'}) said "techno" while the
 *              bassline, Dorian scale and jazz chords were all jazz
 *   underclaim breakbeat/trap/jungle/experimental said supported:true
 *              over a bassline byte-identical to techno's
 */

import {
  BASS_STYLES, DRUM_STYLES, STYLE_ALIASES,
  resolveBassStyle, resolveDrumStyle, resolveLayers,
} from '../../services/StyleRegistry';
import { PatternGenerator } from '../../services/PatternGenerator';
import { execute as composeExecute } from '../../server/tools/compose';
import { execute as generateExecute } from '../../server/tools/generate';
import type { ToolContext } from '../../server/tools/types';

function makeCtx(): ToolContext {
  let current = '';
  return {
    perfMonitor: { start: jest.fn(), end: jest.fn() },
    generator: new PatternGenerator(),
    theory: {}, store: {}, sessionManager: {},
    geminiService: { isAvailable: () => false },
    strudelEngine: {}, midiExportService: {}, midiImportService: {}, audioExportService: {},
    getAudioCaptureService: async () => ({}),
    dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }),
    dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => ({
      writePattern: jest.fn(async (p: string) => { current = p; return 'w'; }),
      play: jest.fn(),
    }),
    getCurrentPatternSafe: async () => current,
    writePatternSafe: async (p: string) => { current = p; return 'written'; },
  } as unknown as ToolContext;
}

describe('the registry describes the generator accurately (#294)', () => {
  const gen = new PatternGenerator();
  const techno = gen.generateBassline('C', 'techno');

  it.each(BASS_STYLES as string[])(
    '%s has a bassline genuinely its own', style => {
      // If a style is claimed to have a bassline, it must not be the
      // techno fallback wearing another name — that claim is what made
      // breakbeat report supported:true over techno material.
      if (style === 'techno') return;
      expect(gen.generateBassline('C', style)).not.toBe(techno);
    });

  it.each(DRUM_STYLES as string[])(
    '%s has drums genuinely its own', style => {
      if (style === 'techno') return;
      expect(gen.generateDrumPattern(style, 0.5))
        .not.toBe(gen.generateDrumPattern('techno', 0.5));
    });

  it('every style claimed to lack a bassline really falls back to techno', () => {
    for (const style of ['breakbeat', 'trap', 'jungle', 'experimental', 'vaporwave']) {
      expect(resolveBassStyle(style).supported).toBe(false);
      expect(gen.generateBassline('C', style)).toBe(techno);
    }
  });

  it('every alias target has at least one layer of its own', () => {
    for (const target of Object.values(STYLE_ALIASES)) {
      expect(
        DRUM_STYLES.includes(target) || BASS_STYLES.includes(target),
      ).toBe(true);
    }
  });
});

describe('resolveLayers (#294)', () => {
  it('jazz: real bass, chords and scale; only drums substituted', () => {
    expect(resolveLayers('jazz')).toEqual({
      requested: 'jazz',
      layers: { drums: 'techno', bass: 'jazz', chords: 'jazz', scale: 'dorian' },
      substituted: ['drums'],
    });
  });

  it('breakbeat: real drums, substituted bass — the case that read as fully supported', () => {
    const r = resolveLayers('breakbeat');
    expect(r.layers.drums).toBe('breakbeat');
    expect(r.layers.bass).toBe('techno');
    expect(r.substituted).toEqual(['bass']);
  });

  it('techno substitutes nothing', () => {
    expect(resolveLayers('techno').substituted).toEqual([]);
  });

  it('an alias resolves both layers to the canonical style', () => {
    const r = resolveLayers('bukem');
    expect(r.layers.drums).toBe('intelligent_dnb');
    expect(r.layers.bass).toBe('intelligent_dnb');
    expect(r.substituted).toEqual([]);
  });

  it('an unknown genre substitutes both', () => {
    expect(resolveLayers('vaporwave').substituted).toEqual(['drums', 'bass']);
  });
});

describe('compose reports per layer (#294)', () => {
  it('jazz is no longer called techno', async () => {
    const r: any = await composeExecute(
      'compose', { style: 'jazz', auto_play: false }, makeCtx());
    // The pattern really does contain a jazz bassline and jazz chords.
    expect(r.metadata.style).toBe('jazz');
    expect(r.metadata.layers.bass).toBe('jazz');
    expect(r.metadata.layers.drums).toBe('techno');
    expect(r.metadata.substituted).toEqual(['drums']);
    expect(r.message).toContain('No drums defined for style "jazz"');
  });

  it('breakbeat discloses its techno bassline', async () => {
    const r: any = await composeExecute(
      'compose', { style: 'breakbeat', auto_play: false }, makeCtx());
    expect(r.metadata.substituted).toEqual(['bass']);
    expect(r.message).toContain('No bass defined');
  });

  it('a fully supported style reports no substitution at all', async () => {
    const r: any = await composeExecute(
      'compose', { style: 'techno', auto_play: false }, makeCtx());
    expect(r.metadata.substituted).toEqual([]);
    expect(r.message).toBe('Created techno pattern in C');
  });

  it('an unknown genre names both substituted layers', async () => {
    const r: any = await composeExecute(
      'compose', { style: 'vaporwave', auto_play: false }, makeCtx());
    expect(r.metadata.substituted).toEqual(['drums', 'bass']);
    expect(r.message).toContain('drums: techno');
    expect(r.message).toContain('bass: techno');
  });

  it('metadata.style is always exactly what was asked for', async () => {
    for (const style of ['jazz', 'breakbeat', 'vaporwave', 'BuKeM']) {
      const r: any = await composeExecute(
        'compose', { style, auto_play: false }, makeCtx());
      expect(r.metadata.style).toBe(style);
    }
  });
});

describe('generate_part role=bass (#294)', () => {
  it('discloses the substituted bassline', async () => {
    const r = await generateExecute(
      'generate_part', { role: 'bass', key: 'C', style: 'vaporwave' }, makeCtx());
    expect(String(r)).toContain('No bassline for style "vaporwave"');
    expect(String(r)).toContain('techno');
  });

  it('reports a real one plainly', async () => {
    const r = await generateExecute(
      'generate_part', { role: 'bass', key: 'C', style: 'jazz' }, makeCtx());
    expect(String(r)).toBe('Generated jazz bassline in C');
  });
});

describe('prototype keys do not crash style lookup (#295)', () => {
  const gen = new PatternGenerator();

  it.each(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf'])(
    '%s resolves to a real style instead of throwing', style => {
      // STYLE_ALIASES is a plain object literal, so STYLE_ALIASES['constructor']
      // returned Object and ['__proto__'] the prototype. Neither is nullish,
      // so `?? lower` never fired and the result was used as a string.
      expect(() => gen.generateCompletePattern(style, 'C', 120)).not.toThrow();
      expect(typeof resolveDrumStyle(style).resolved).toBe('string');
      expect(typeof resolveLayers(style).layers.bass).toBe('string');
    });

  it('a prototype key is reported as substituted, not as a real genre', () => {
    expect(resolveLayers('__proto__').substituted).toEqual(['drums', 'bass']);
  });
});
