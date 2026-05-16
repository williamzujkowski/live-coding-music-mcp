/**
 * Tests for the import_midi tool wiring (#201).
 *
 * Exercises the storage-module dispatch path: source=base64 and source=path
 * inputs, the security caps (size limit, path traversal), and the drum_map
 * argument normalization (JSON string keys → number keys).
 */

import * as midiModule from '@tonejs/midi';
const Midi: any = (midiModule as any).Midi || (midiModule as any).default?.Midi;

import { execute } from '../../server/tools/storage';
import type { ToolContext } from '../../server/tools/types';
import { MIDIImportService } from '../../services/MIDIImportService';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';

function buildMidi(notes: Array<{ midi: number; time: number; channel?: number }>): Buffer {
  const midi = new Midi();
  midi.header.setTempo(120);
  for (const n of notes) {
    const t = midi.addTrack();
    t.channel = n.channel ?? 0;
    t.addNote({ midi: n.midi, time: n.time, duration: 0.1, velocity: 0.8 });
  }
  return Buffer.from(midi.toArray());
}

function makeCtx(): ToolContext {
  return {
    controller: {} as any,
    perfMonitor: {} as any,
    store: {} as any,
    generator: {} as any,
    theory: {} as any,
    sessionManager: {} as any,
    geminiService: {} as any,
    strudelEngine: {} as any,
    midiExportService: {} as any,
    midiImportService: new MIDIImportService(),
    getAudioCaptureService: async () => ({}) as any,
    dropAudioCaptureService: jest.fn(),
    getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }),
    historyEntryId: () => 1,
    dropHistory: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
    isInitialized: () => true,
    ensureInitialized: async () => {},
    getController: () => ({}) as any,
    getCurrentPatternSafe: async () => '',
    writePatternSafe: async () => 'written',
  };
}

describe('import_midi tool (#201)', () => {
  describe('source=base64', () => {
    it('converts a base64-encoded .mid into a Strudel pattern envelope', async () => {
      const buf = buildMidi([{ midi: 60, time: 0 }, { midi: 64, time: 0.5 }]);
      const result: any = await execute('import_midi', {
        source: 'base64',
        data: buf.toString('base64'),
      }, makeCtx());
      expect(result.ok).toBe(true);
      expect(result.data.pattern).toContain('setcpm(120)');
      expect(result.data.pattern).toContain('stack(');
      expect(result.data.summary.notes).toBe(2);
    });

    it('rejects oversized base64 input', async () => {
      // Allocate a 2.5MB string of "A" — base64 length exceeds MAX*2.
      const huge = 'A'.repeat(2_500_000);
      const result: any = await execute('import_midi', {
        source: 'base64',
        data: huge,
      }, makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCategory).toBe('validation');
      expect(result.message).toMatch(/too large/i);
    });

    it('rejects empty data', async () => {
      const result: any = await execute('import_midi', {
        source: 'base64',
        data: '',
      }, makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCategory).toBe('validation');
    });

    it('rejects garbage base64 that does not parse as MIDI', async () => {
      const result: any = await execute('import_midi', {
        source: 'base64',
        data: Buffer.from('not a midi file').toString('base64'),
      }, makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCategory).toBe('validation');
    });
  });

  describe('source=path', () => {
    const fixtureDir = resolve('./patterns/midi');
    const fixtureName = 'test-import-midi.mid';
    const fixturePath = resolve(fixtureDir, fixtureName);

    beforeAll(() => {
      mkdirSync(fixtureDir, { recursive: true });
      const buf = buildMidi([{ midi: 60, time: 0 }, { midi: 64, time: 0.5 }]);
      writeFileSync(fixturePath, buf);
    });

    afterAll(() => {
      try { rmSync(fixturePath); } catch { /* fixture cleanup is best-effort */ }
    });

    it('loads from patterns/midi/<basename>', async () => {
      const result: any = await execute('import_midi', {
        source: 'path',
        data: fixtureName,
      }, makeCtx());
      expect(result.ok).toBe(true);
      expect(result.data.summary.notes).toBe(2);
    });

    it('blocks path traversal via "../"', async () => {
      const result: any = await execute('import_midi', {
        source: 'path',
        data: '../../etc/passwd',
      }, makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCategory).toBe('validation');
      expect(result.message).toMatch(/traversal|invalid/i);
    });

    it('blocks absolute paths', async () => {
      const result: any = await execute('import_midi', {
        source: 'path',
        data: '/etc/passwd',
      }, makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCategory).toBe('validation');
    });
  });

  describe('drum_map normalization', () => {
    it('accepts JSON-style string keys for drum_map', async () => {
      const buf = buildMidi([{ midi: 99, time: 0, channel: 9 }]);
      const result: any = await execute('import_midi', {
        source: 'base64',
        data: buf.toString('base64'),
        drum_map: { '99': 'cp' },
      }, makeCtx());
      expect(result.ok).toBe(true);
      expect(result.data.summary.unmapped_drums).toEqual([]);
      expect(result.data.pattern).toMatch(/s\("cp[^"]*"\)/);
    });

    it('rejects invalid drum_map entries', async () => {
      const buf = buildMidi([{ midi: 99, time: 0, channel: 9 }]);
      const result: any = await execute('import_midi', {
        source: 'base64',
        data: buf.toString('base64'),
        drum_map: { 'not-a-number': 'cp' },
      }, makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCategory).toBe('validation');
    });
  });

  describe('source validation', () => {
    it('rejects unknown source values', async () => {
      const result: any = await execute('import_midi', {
        source: 'http',
        data: 'http://example.com/file.mid',
      }, makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCategory).toBe('validation');
    });
  });
});
