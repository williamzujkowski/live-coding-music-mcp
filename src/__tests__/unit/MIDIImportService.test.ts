/**
 * Unit tests for MIDIImportService (Phase 1, #201).
 *
 * Fixtures are generated in-test via @tonejs/midi so the .mid bytes are
 * deterministic, reviewable, and don't need a checked-in binary.
 *
 * The critical test is `should not drop drum events that share a grid step` —
 * this guards against the collision bug the design spike exposed: emitting
 * drums as a single merged s() string overwrites simultaneous samples.
 */

import * as midiModule from '@tonejs/midi';
const Midi: any = (midiModule as any).Midi || (midiModule as any).default?.Midi;

import { MIDIImportService, GM_DRUM_MAP, MAX_NOTES } from '../../services/MIDIImportService';

/** Build a synthetic .mid Buffer with the given tracks. Returns raw bytes. */
function buildMidi(
  bpm: number,
  tracks: Array<{
    channel: number;
    notes: Array<{ midi: number; time: number; duration?: number; velocity?: number }>;
  }>,
): Buffer {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  for (const t of tracks) {
    const track = midi.addTrack();
    track.channel = t.channel;
    for (const n of t.notes) {
      track.addNote({
        midi: n.midi,
        time: n.time,
        duration: n.duration ?? 0.1,
        velocity: n.velocity ?? 0.8,
      });
    }
  }
  return Buffer.from(midi.toArray());
}

describe('MIDIImportService', () => {
  let service: MIDIImportService;
  beforeEach(() => {
    service = new MIDIImportService();
  });

  describe('basic conversion', () => {
    it('emits setcpm + stack with the header tempo', () => {
      const buf = buildMidi(140, [
        { channel: 0, notes: [{ midi: 60, time: 0 }, { midi: 62, time: 0.5 }] },
      ]);
      const { pattern, summary } = service.convertBuffer(buf);
      expect(pattern).toContain('setcpm(140)');
      expect(pattern).toContain('stack(');
      expect(summary.bpm).toBe(140);
      expect(summary.notes).toBe(2);
    });

    it('reports zero-lane fallback for an empty MIDI file', () => {
      const buf = buildMidi(120, []);
      const { pattern, summary } = service.convertBuffer(buf);
      expect(pattern).toContain('silence');
      expect(summary.lanes).toBe(0);
      expect(summary.notes).toBe(0);
    });
  });

  describe('drum lane splitting', () => {
    it('should not drop drum events that share a grid step', () => {
      // 1 bar at 120 BPM = 2 seconds. 16 steps/bar → 0.125s per step.
      // Step 0: kick AND closed hat at the same instant.
      // Step 4 (beat 2): snare AND closed hat at the same instant.
      // The bug we're guarding against: merging into one s() string loses
      // the hat hits, because step 0 can only hold one token.
      const buf = buildMidi(120, [
        {
          channel: 9, // GM ch10
          notes: [
            { midi: 36, time: 0.0 },   // kick at step 0
            { midi: 42, time: 0.0 },   // closed hat at step 0  ← same step as kick
            { midi: 38, time: 0.5 },   // snare at step 4
            { midi: 42, time: 0.5 },   // closed hat at step 4  ← same step as snare
            { midi: 42, time: 0.25 },  // closed hat at step 2 (no collision)
          ],
        },
      ]);
      const { pattern, summary } = service.convertBuffer(buf, { steps_per_cycle: 16 });

      // Drum should produce one lane per distinct sample, alphabetically sorted: bd, hh, sd.
      expect(summary.lanes).toBe(3);

      // Kick lane: bd on step 0 only.
      expect(pattern).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~"\)/);
      // Snare lane: sd on step 4 only.
      expect(pattern).toMatch(/s\("~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~"\)/);
      // Hat lane: hh on steps 0, 2, AND 4 — none dropped.
      expect(pattern).toMatch(/s\("hh ~ hh ~ hh ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~"\)/);
    });

    it('uses the default GM drum map for common samples', () => {
      const buf = buildMidi(120, [
        { channel: 9, notes: [
          { midi: 36, time: 0 }, { midi: 38, time: 0.5 }, { midi: 42, time: 0.25 },
          { midi: 46, time: 0.75 }, { midi: 49, time: 1.0 },
        ]},
      ]);
      const { pattern } = service.convertBuffer(buf);
      // bd, sd, hh, oh, cr all present
      expect(pattern).toMatch(/s\("bd[^"]*"\)/);
      expect(pattern).toMatch(/s\("[^"]*sd[^"]*"\)/);
      expect(pattern).toMatch(/s\("[^"]*hh[^"]*"\)/);
      expect(pattern).toMatch(/s\("[^"]*oh[^"]*"\)/);
      expect(pattern).toMatch(/s\("[^"]*cr[^"]*"\)/);
    });

    it('surfaces unmapped drum notes in the summary rather than emitting garbage', () => {
      // MIDI note 99 isn't in the GM percussion map.
      const buf = buildMidi(120, [
        { channel: 9, notes: [
          { midi: 36, time: 0 },   // mapped → bd
          { midi: 99, time: 0.5 }, // unmapped
        ]},
      ]);
      const { pattern, summary } = service.convertBuffer(buf);
      expect(summary.unmapped_drums).toContain(99);
      // Unmapped notes don't appear in the pattern body.
      expect(pattern).not.toContain('n99');
      expect(pattern).not.toMatch(/s\("99/);
    });

    it('accepts user drum_map overrides', () => {
      const buf = buildMidi(120, [
        { channel: 9, notes: [{ midi: 99, time: 0 }] },
      ]);
      const { pattern, summary } = service.convertBuffer(buf, { drum_map: { 99: 'cp' } });
      expect(summary.unmapped_drums).toEqual([]);
      expect(pattern).toMatch(/s\("cp[^"]*"\)/);
    });
  });

  describe('pitched polyphony', () => {
    it('merges simultaneous pitched notes into [a,b,c] chord tokens', () => {
      // C major triad at step 0, single E at step 4.
      const buf = buildMidi(120, [
        { channel: 0, notes: [
          { midi: 60, time: 0 },   // C4
          { midi: 64, time: 0 },   // E4
          { midi: 67, time: 0 },   // G4
          { midi: 64, time: 0.5 }, // E4 alone
        ]},
      ]);
      const { pattern } = service.convertBuffer(buf, { steps_per_cycle: 16 });
      expect(pattern).toContain('[c4,e4,g4]');
      // Single E4 should appear as plain "e4" (no brackets)
      expect(pattern).toMatch(/\[c4,e4,g4\] ~ ~ ~ e4 /);
    });

    it('renders single-bar melodies without <...> alternation wrapper', () => {
      const buf = buildMidi(120, [
        { channel: 0, notes: [
          { midi: 60, time: 0 }, { midi: 62, time: 0.5 },
          { midi: 64, time: 1.0 }, { midi: 65, time: 1.5 },
        ]},
      ]);
      const { pattern, summary } = service.convertBuffer(buf, { steps_per_cycle: 16 });
      expect(summary.bars).toBe(1);
      expect(pattern).not.toContain('<');
      expect(pattern).toContain('c4 ~ ~ ~ d4 ~ ~ ~ e4 ~ ~ ~ f4');
    });

    it('renders multi-bar melodies with <bar1 bar2> alternation', () => {
      const buf = buildMidi(120, [
        { channel: 0, notes: [
          { midi: 60, time: 0 },        // bar 1
          { midi: 62, time: 2.0 },      // bar 2
        ]},
      ]);
      const { pattern, summary } = service.convertBuffer(buf, { steps_per_cycle: 16 });
      expect(summary.bars).toBe(2);
      expect(pattern).toContain('note("<[c4 ');
      expect(pattern).toContain('] [d4 ');
      expect(pattern).toContain(']>").s("piano")');
    });
  });

  describe('options & validation', () => {
    it('honors bars cap', () => {
      const buf = buildMidi(120, [
        { channel: 0, notes: [
          { midi: 60, time: 0 }, { midi: 62, time: 2.0 }, { midi: 64, time: 4.0 },
        ]},
      ]);
      const { summary } = service.convertBuffer(buf, { bars: 2 });
      expect(summary.bars).toBe(2);
    });

    it('honors steps_per_cycle', () => {
      const buf = buildMidi(120, [
        { channel: 0, notes: [{ midi: 60, time: 0 }, { midi: 62, time: 1.0 }] },
      ]);
      const { summary } = service.convertBuffer(buf, { steps_per_cycle: 8 });
      expect(summary.steps_per_cycle).toBe(8);
    });

    it('rejects out-of-range steps_per_cycle', () => {
      const buf = buildMidi(120, [{ channel: 0, notes: [{ midi: 60, time: 0 }] }]);
      expect(() => service.convertBuffer(buf, { steps_per_cycle: 0 })).toThrow(/Invalid steps_per_cycle/);
      expect(() => service.convertBuffer(buf, { steps_per_cycle: 65 })).toThrow(/Invalid steps_per_cycle/);
      expect(() => service.convertBuffer(buf, { steps_per_cycle: 1.5 })).toThrow(/Invalid steps_per_cycle/);
    });

    it('throws on unparseable input', () => {
      const garbage = Buffer.from('not a midi file');
      expect(() => service.convertBuffer(garbage)).toThrow(/parse/i);
    });

    it('refuses pathologically large note counts', () => {
      // Build a track with MAX_NOTES + 1 notes; should bail before rendering.
      const notes = Array.from({ length: MAX_NOTES + 1 }, (_, i) => ({
        midi: 60,
        time: i * 0.001,
        duration: 0.001,
      }));
      const buf = buildMidi(120, [{ channel: 0, notes }]);
      expect(() => service.convertBuffer(buf)).toThrow(/too many notes/);
    });
  });

  describe('GM_DRUM_MAP', () => {
    it('covers the common GM percussion notes (35-59)', () => {
      const required = [35, 36, 38, 40, 42, 46, 49, 51];
      for (const n of required) {
        expect(GM_DRUM_MAP[n]).toBeDefined();
        expect(typeof GM_DRUM_MAP[n]).toBe('string');
        expect(GM_DRUM_MAP[n].length).toBeGreaterThan(0);
      }
    });
  });
});
