/**
 * The tempo table and the style tables must agree (#296).
 *
 * TEMPO_BY_STYLE lived in compose.ts and contradicted the style tables
 * in both directions:
 *
 *   - no entry for intelligent_dnb / trip_hop / boom_bap, so all three
 *     fell to 120. compose passes that 120 down, so the generator's own
 *     `bpm || 170` fallback was unreachable: compose({style:'bukem'})
 *     emitted "// Intelligent DnB in C at 120 BPM".
 *   - carried 'drum and bass' at 174, a style STYLE_ALIASES had never
 *     heard of, so the request produced 174-BPM *techno*.
 */

import {
  BASS_STYLES, DRUM_STYLES, STYLE_ALIASES,
  TEMPO_BY_STYLE, TEMPO_ONLY_STYLES,
  defaultTempoFor, resolveLayers,
} from '../../services/StyleRegistry';
import { PatternGenerator } from '../../services/PatternGenerator';

describe('the tempo table agrees with the style tables (#296)', () => {
  it('every tempo key is a known style or an explicit tempo-only entry', () => {
    const layered = new Set<string>([...DRUM_STYLES, ...BASS_STYLES]);
    const orphans = Object.keys(TEMPO_BY_STYLE)
      .filter(k => !layered.has(k) && !TEMPO_ONLY_STYLES.includes(k));
    // An unlisted key means the two tables have drifted again.
    expect(orphans).toEqual([]);
  });

  it('no tempo key is an alias — aliases resolve before lookup', () => {
    const aliasKeys = Object.keys(STYLE_ALIASES);
    for (const key of Object.keys(TEMPO_BY_STYLE)) {
      expect(aliasKeys).not.toContain(key);
    }
  });

  it('every tempo-only style really has no layers of its own', () => {
    for (const style of TEMPO_ONLY_STYLES) {
      expect(DRUM_STYLES).not.toContain(style);
      expect(BASS_STYLES).not.toContain(style);
      // ...and says so when asked.
      expect(resolveLayers(style).substituted).toEqual(['drums', 'bass']);
    }
  });

  it('every style with drums has a tempo of its own', () => {
    for (const style of DRUM_STYLES) {
      expect(Object.keys(TEMPO_BY_STYLE)).toContain(style);
    }
  });
});

describe('defaultTempoFor resolves aliases (#296)', () => {
  it.each([
    ['bukem', 170],
    ['liquid_dnb', 170],
    ['intelligent_dnb', 170],
    ['triphop', 90],
    ['trip_hop', 90],
    ['boombap', 92],
    ['boom_bap', 92],
  ])('%s -> %i BPM', (style, bpm) => {
    // These all fell to 120 before, because the lookup happened on the
    // raw string with no entry for the canonical style.
    expect(defaultTempoFor(style)).toBe(bpm);
  });

  it('drum and bass is dnb, not 174-BPM techno', () => {
    expect(defaultTempoFor('drum and bass')).toBe(174);
    expect(resolveLayers('drum and bass').layers.drums).toBe('dnb');
    expect(resolveLayers('drum and bass').substituted).toEqual([]);
  });

  it('an unknown style still falls back to 120', () => {
    expect(defaultTempoFor('vaporwave')).toBe(120);
  });

  it('is case-insensitive', () => {
    expect(defaultTempoFor('BuKeM')).toBe(170);
  });

  it('survives a prototype key', () => {
    expect(defaultTempoFor('__proto__')).toBe(120);
    expect(defaultTempoFor('constructor')).toBe(120);
  });
});

describe('the specialized genres reach their own tempo end to end (#296)', () => {
  const gen = new PatternGenerator();

  it.each([
    ['bukem', 170],
    ['triphop', 90],
    ['boombap', 92],
  ])('compose(%s) generates at %i BPM', (style, bpm) => {
    // compose passes defaultTempoFor's answer into the generator, so a
    // wrong default here silently became the pattern's real tempo.
    const header = gen.generateCompletePattern(style, 'C', defaultTempoFor(style))
      .split('\n')[0];
    expect(header).toContain(`${bpm} BPM`);
  });
});
