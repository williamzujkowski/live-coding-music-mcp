/**
 * Tests for #279 (silent genre substitution) and #280 (MIDI parse
 * failures reported as internal errors).
 *
 * An unknown genre falls back to techno drums. That fallback is fine —
 * what wasn't fine is that every layer above it echoed the requested
 * style back, so a caller asking for vaporwave was told it got
 * vaporwave, in the metadata, the message and the pattern's own header.
 */

import { PatternGenerator } from '../../services/PatternGenerator';
import { DRUM_STYLES, STYLE_ALIASES, resolveDrumStyle } from '../../services/StyleRegistry';
import { MIDIImportService } from '../../services/MIDIImportService';
import { categorizeError } from '../../server/tools/types';
import { execute as composeExecute } from '../../server/tools/compose';
import { execute as generateExecute } from '../../server/tools/generate';
import { execute as storageExecute } from '../../server/tools/storage';
import type { ToolContext } from '../../server/tools/types';

function makeCtx() {
  let currentPattern = '';
  const controller = {
    writePattern: jest.fn(async (p: string) => { currentPattern = p; return 'written'; }),
    getCurrentPattern: jest.fn(async () => currentPattern),
    play: jest.fn(async () => 'playing'),
  };
  const ctx = {
    perfMonitor: { start: jest.fn(), end: jest.fn() },
    store: {}, theory: {}, sessionManager: {},
    generator: new PatternGenerator(),
    geminiService: { isAvailable: () => false },
    strudelEngine: {}, midiExportService: {}, midiImportService: {},
    audioExportService: {},
    getAudioCaptureService: async () => ({}),
    dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }),
    dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => controller,
    getCurrentPatternSafe: async () => currentPattern,
    writePatternSafe: async (p: string) => { currentPattern = p; return 'written'; },
  } as unknown as ToolContext;
  return { ctx, controller, pattern: () => currentPattern };
}

describe('style substitution is reported, not hidden (#279)', () => {
  describe('resolveDrumStyle', () => {
    it('reports a supported style as itself', () => {
      expect(resolveDrumStyle('house')).toEqual({
        requested: 'house', resolved: 'house', supported: true,
      });
    });

    it('resolves an alias to its canonical style', () => {
      expect(resolveDrumStyle('bukem')).toEqual({
        requested: 'bukem', resolved: 'intelligent_dnb', supported: true,
      });
    });

    it('flags an unknown genre as substituted', () => {
      expect(resolveDrumStyle('vaporwave')).toEqual({
        requested: 'vaporwave', resolved: 'techno', supported: false,
      });
    });

    it('flags jazz, which is documented but has no drums', () => {
      expect(resolveDrumStyle('jazz').supported).toBe(false);
    });

    it('every alias target is a style that actually has drums', () => {
      for (const target of Object.values(STYLE_ALIASES)) {
        expect(DRUM_STYLES).toContain(target);
      }
    });
  });

  describe('generateCompletePattern header', () => {
    it('names the style that produced the drums, not the one requested', () => {
      const header = new PatternGenerator()
        .generateCompletePattern('vaporwave', 'C', 120).split('\n')[0];
      expect(header).toContain('techno');
      expect(header).toContain('no drums defined for "vaporwave"');
    });

    it('leaves a supported style alone', () => {
      const header = new PatternGenerator()
        .generateCompletePattern('house', 'C', 120).split('\n')[0];
      expect(header).toBe('// house pattern in C at 120 BPM');
      expect(header).not.toContain('no drums defined');
    });
  });

  describe('compose', () => {
    it('stamps the substituted style and says so', async () => {
      const { ctx } = makeCtx();
      const r: any = await composeExecute(
        'compose', { style: 'vaporwave', auto_play: false }, ctx);
      // #294 replaced the collapsed style field with per-layer
      // reporting: metadata.style is the request, layers say what plays.
      expect(r.metadata.style).toBe('vaporwave');
      expect(r.metadata.layers.drums).toBe('techno');
      expect(r.metadata.substituted).toContain('drums');
      expect(r.message).toContain('No drums or bass defined for style "vaporwave"');
    });

    it('adds no substitution fields for a real style', async () => {
      const { ctx } = makeCtx();
      const r: any = await composeExecute(
        'compose', { style: 'techno', auto_play: false }, ctx);
      expect(r.metadata.style).toBe('techno');
      expect(r.metadata.substituted).toEqual([]);
      expect(r.message).not.toContain('No drums');
    });

    it('reports the canonical name when an alias was used', async () => {
      const { ctx } = makeCtx();
      const r: any = await composeExecute(
        'compose', { style: 'bukem', auto_play: false }, ctx);
      expect(r.metadata.style).toBe('bukem');
      expect(r.metadata.layers.drums).toBe('intelligent_dnb');
      expect(r.metadata.substituted).toEqual([]);
    });
  });

  describe('generate_part role=drums', () => {
    it('says which style the drums actually came from', async () => {
      const { ctx } = makeCtx();
      const r = await generateExecute(
        'generate_part', { role: 'drums', style: 'vaporwave' }, ctx);
      expect(String(r)).toContain('No drum pattern for style "vaporwave"');
      expect(String(r)).toContain('techno');
    });

    it('reports a supported style plainly', async () => {
      const { ctx } = makeCtx();
      const r = await generateExecute(
        'generate_part', { role: 'drums', style: 'house' }, ctx);
      expect(String(r)).toBe('Generated house drums');
    });
  });
});

describe('MIDI parse failure describes the file (#280)', () => {
  const svc = new MIDIImportService();

  it('does not leak the parser TypeError as the whole message', () => {
    let caught: Error | undefined;
    try {
      svc.convertBuffer(Buffer.from('MThd\x00\x00\x00\x06', 'binary'));
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('Invalid MIDI file');
    expect(caught!.message).toContain('MThd');
    // Not "Cannot read properties of undefined" as the leading text.
    expect(caught!.message.startsWith('Cannot read properties')).toBe(false);
  });

  it('categorises a parse failure as the caller\'s problem, not a server bug', () => {
    let caught: Error | undefined;
    try {
      svc.convertBuffer(Buffer.from('not a midi file at all', 'binary'));
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(categorizeError(caught)).toBe('validation');
  });

  it('categorises the bar cap as validation, so the advice is deliverable', () => {
    expect(categorizeError(new Error(
      'MIDI file spans too many bars (900 > 512). Pass bars=<n> to import a prefix.',
    ))).toBe('validation');
  });
});

describe('import_midi delivers the cap advice as validation (#280)', () => {
  function ctxWith(message: string): ToolContext {
    return {
      midiImportService: {
        convertBuffer: () => { throw new Error(message); },
      },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      isInitialized: () => true,
    } as unknown as ToolContext;
  }

  const call = (message: string) => storageExecute(
    'import_midi',
    { source: 'base64', data: Buffer.from('MThd').toString('base64') },
    ctxWith(message),
  ) as Promise<any>;

  it('files the bar cap under validation, not internal', async () => {
    const r = await call('MIDI file spans too many bars (900 > 512). Pass bars=<n> to import a prefix.');
    expect(r.ok).toBe(false);
    expect(r.errorCategory).toBe('validation');
    // The whole point of the message is the advice; it must survive.
    expect(r.message).toContain('Pass bars=<n>');
  });

  it('files the track cap under validation', async () => {
    const r = await call('MIDI file has too many tracks (100 > 64).');
    expect(r.errorCategory).toBe('validation');
  });

  it('files the note cap under validation', async () => {
    const r = await call('MIDI file has too many notes (>50000).');
    expect(r.errorCategory).toBe('validation');
  });
});
