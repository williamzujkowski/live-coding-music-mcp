import { MusicTheory } from './MusicTheory.js';
import { STYLE_ALIASES, resolveDrumStyle } from './StyleRegistry.js';
import { lookup } from '../utils/TableLookup.js';
import { ValidationError } from '../utils/CategorisedError.js';
import { BEATS_PER_CYCLE } from '../utils/Tempo.js';

export class PatternGenerator {
  private theory = new MusicTheory();

  // Note interval lookup for chord calculations
  private readonly notes = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];

  /**
   * Get a note at a specific interval from the root
   */
  private getInterval(root: string, semitones: number): string {
    // The `.replace('#','b')` used to run BEFORE this lookup, so its
    // keys could never match — dead code. 'c#' became 'cb', which is not
    // in `notes`, so the root came back unchanged; 'd#' became 'db',
    // which IS in `notes` but is the wrong note, a semitone flat. So
    // getFifth('D#') returned 'ab' and getFifth('F#') returned 'F#',
    // while MusicTheory.getNote got the same intervals right (#318).
    const lower = root.toLowerCase();
    const sharpToFlat: Record<string, string> = {
      'c#': 'db', 'd#': 'eb', 'f#': 'gb', 'g#': 'ab', 'a#': 'bb',
      // Enharmonics that are not in `notes` but are legal input.
      'e#': 'f', 'b#': 'c', 'cb': 'b', 'fb': 'e',
    };
    const searchRoot = Object.hasOwn(sharpToFlat, lower) ? sharpToFlat[lower] : lower;
    const idx = this.notes.indexOf(searchRoot);
    if (idx === -1) return root;
    // Modulo alone goes negative for a negative interval; none are used
    // today, but the guard costs nothing and the bug it prevents is the
    // same shape as the one above.
    return this.notes[(((idx + semitones) % 12) + 12) % 12];
  }

  private getFourth(root: string): string { return this.getInterval(root, 5); }
  private getFifth(root: string): string { return this.getInterval(root, 7); }
  private getMinorThird(root: string): string { return this.getInterval(root, 3); }
  private getMinorSeventh(root: string): string { return this.getInterval(root, 10); }

  /**
   * Generates a drum pattern for a given style
   * @param style - Music style (e.g., 'techno', 'house', 'dnb', 'ambient')
   * @param complexity - Pattern complexity from 0 to 1 (default: 1)
   * @returns Strudel drum pattern code
   */
  generateDrumPattern(style: string, complexity: number = 1): string {
    const patterns: Record<string, string[]> = {
      techno: [
        's("bd*4")',
        's("bd*4, ~ cp ~ cp")',
        's("bd*4, ~ cp ~ cp, hh*8")',
        's("bd*4, ~ cp ~ cp, [~ hh]*4, oh ~ ~ ~").swing(0.05)'
      ],
      house: [
        's("bd*4, hh*8")',
        's("bd*4, hh*8, ~ cp ~ cp")',
        's("bd*4, [~ hh]*4, ~ cp ~ cp, oh ~ oh ~")',
        's("bd*4, [~ hh]*4, ~ cp ~ cp").every(4, x => x.fast(2))'
      ],
      dnb: [
        's("bd ~ ~ bd ~ ~ bd ~, ~ ~ cp ~ ~ cp ~ ~")',
        's("bd ~ ~ [bd bd] ~ ~ bd ~, ~ ~ cp ~ ~ cp ~ ~, hh*16")',
        's("bd ~ ~ [bd bd] ~ ~ bd ~, ~ ~ cp ~ [~ cp] ~ cp ~ ~, hh*16").fast(2)'
      ],
      breakbeat: [
        's("bd ~ ~ bd ~ ~ ~ bd, ~ cp ~ ~ cp ~")',
        's("bd ~ ~ bd ~ [~ bd] ~ bd, ~ cp ~ ~ cp ~, hh*8")',
        's("bd ~ [~ bd] bd ~ [~ bd] ~ bd, ~ cp ~ ~ cp [~ cp], hh*8").swing(0.1)'
      ],
      trap: [
        's("bd*2, ~ cp ~ cp")',
        's("bd*2, ~ cp ~ cp, hh*8").every(2, x => x.fast(2))',
        's("bd [bd bd] ~ bd, ~ cp ~ cp, hh*16").swing(0.2)'
      ],
      jungle: [
        's("bd ~ [~ bd] bd ~ ~ bd ~, ~ cp ~ ~ cp ~").fast(2)',
        's("bd ~ [~ bd] bd ~ [bd bd] bd ~, ~ cp ~ [~ cp] cp ~, hh*32").fast(2)'
      ],
      ambient: [
        's("bd ~ ~ ~")',
        's("bd ~ ~ ~, ~ ~ ~ hh:8").room(0.9)',
        's("bd ~ ~ ~, ~ ~ ~ hh:8, ~ ~ oh:5 ~").room(0.9).gain(0.5)'
      ],
      experimental: [
        's("bd").euclid(5, 8)',
        's("bd cp").euclid(7, 16)',
        's("bd cp hh").euclid(choose([3, 5, 7]), 16)'
      ],
      // === NEW GENRES ===
      intelligent_dnb: [
        // Minimal - sparse break
        `s("breaks165").fit().slice(8, "0 ~ ~ 3 ~ ~ 6 ~").gain(0.5).room(0.3).lpf(5000)`,
        // Medium - classic rolling break
        `s("breaks165").fit().slice(8, "0 0 6 3 0 2 6 7").gain(0.7).room(0.2)`,
        // Complex - layered breaks
        `stack(
          s("breaks165").fit().slice(8, "0 0 6 3 0 2 6 7").gain(0.65).room(0.2),
          s("breaks165").fit().chop(16).gain(0.12).hpf(3000).room(0.4),
          s("bd ~ ~ ~ [~ bd] ~ bd ~").bank("RolandTR909").gain(0.45).lpf(100)
        )`
      ],
      trip_hop: [
        // Minimal - sparse and moody
        `s("bd ~ ~ ~, ~ ~ ~ sd:3").room(0.5).gain(0.7)`,
        // Medium - classic trip hop groove
        `stack(
          s("bd ~ ~ bd ~ ~ bd ~").gain(0.8),
          s("~ ~ ~ ~ sd ~ ~ ~").bank("RolandTR808").gain(0.7).room(0.4),
          s("hh*8").gain(0.25).hpf(6000).pan(sine.range(0.3, 0.7))
        )`,
        // Complex - layered with vinyl texture
        `stack(
          s("bd ~ [~ bd] ~ bd ~ ~ ~").gain(0.8),
          s("~ ~ ~ ~ sd ~ ~ sd:2?").bank("RolandTR808").gain(0.7).room(0.5),
          s("hh*8").gain(perlin.range(0.15, 0.3)).hpf(5000),
          s("~ oh ~ ~ ~ oh ~ ~").bank("RolandTR808").gain(0.2).room(0.6)
        ).slow(2)`
      ],
      boom_bap: [
        // Minimal - hard kick and snare
        `s("bd ~ ~ ~ sd ~ ~ ~, bd ~ ~ ~ sd ~ bd ~")`,
        // Medium - classic boom bap with hats
        `stack(
          s("bd ~ ~ ~ sd ~ ~ ~, bd ~ ~ bd sd ~ bd ~").gain(0.9),
          s("hh*8").gain(0.4).hpf(5000),
          s("~ ~ oh ~ ~ ~ oh ~").gain(0.3)
        ).swing(0.08)`,
        // Complex - layered golden era style
        `stack(
          s("bd ~ ~ [~ bd] sd ~ ~ ~, bd ~ ~ bd sd ~ [bd bd] ~").gain(0.9),
          s("~ ~ ~ ~ sd:3 ~ ~ ~").gain(0.3).room(0.2),
          s("[~ hh]*8").gain(0.45).hpf(4000),
          s("~ ~ oh ~ ~ ~ ~ oh:2").gain(0.25).room(0.3)
        ).swing(0.1)`
      ]
    };

    // Handle aliases
    // hasOwn, not `??`: STYLE_ALIASES is a plain object literal, so
    // STYLE_ALIASES['constructor'] returns Object and ['__proto__'] the
    // prototype. Neither is nullish, so `??` never fired and the result
    // was used as a string — TypeError, categorised `internal` (#295).
    const lowerStyle = String(style ?? '').toLowerCase();
    const resolvedStyle = Object.hasOwn(STYLE_ALIASES, lowerStyle)
      ? STYLE_ALIASES[lowerStyle]
      : lowerStyle;
    const stylePatterns = lookup(patterns, resolvedStyle, patterns.techno);
    const index = Math.min(Math.floor(complexity * stylePatterns.length), stylePatterns.length - 1);
    return stylePatterns[index];
  }

  /**
   * Generates a bassline pattern for a given key and style
   * @param key - Musical key (e.g., 'C', 'D', 'F#')
   * @param style - Music style (e.g., 'techno', 'house', 'acid', 'dub')
   * @returns Strudel bassline pattern code
   */
  generateBassline(key: string, style: string): string {
    const safeKey = key.toLowerCase();
    const fourth = this.getFourth(safeKey);
    const fifth = this.getFifth(safeKey);
    const minorSeventh = this.getMinorSeventh(safeKey);

    const patterns: Record<string, string> = {
      techno: `note("${key}2 ${key}2 ${key}2 ${key}2").s("sawtooth").cutoff(800)`,
      house: `note("${key}2 ~ ${key}2 ~").s("sine").gain(0.8)`,
      dnb: `note("${key}1 ~ ~ ${key}2 ~ ${key}1 ~ ~").s("square").cutoff(400)`,
      acid: `note("${key}2 ${key}3 ${key}2 ${this.theory.getNote(key, 3)}2").s("sawtooth").cutoff(sine.range(200, 2000).slow(4))`,
      dub: `note("${key}1 ~ ~ ~ ${key}1 ~ ${this.theory.getNote(key, 5)}1 ~").s("sine:2").room(0.5)`,
      funk: `note("${key}2 ${key}2 ~ ${this.theory.getNote(key, 5)}2 ~ ${key}2 ${this.theory.getNote(key, 7)}2 ~").s("square").cutoff(1200)`,
      jazz: `note("${key}2 ~ ${this.theory.getNote(key, 4)}2 ~ ${this.theory.getNote(key, 7)}2 ~").s("sine").gain(0.7)`,
      ambient: `note("${key}1").s("sine").attack(2).release(4).gain(0.6)`,
      // === NEW GENRES ===
      intelligent_dnb: `note("<${safeKey}1 ~ ${safeKey}1 ~> <${fourth}1 ~ ~ ${fourth}1> <${minorSeventh}0 ~ ${minorSeventh}0 ~> <${this.getMinorThird(safeKey)}1 ~ ~ ~>")
        .s("sine")
        .gain(0.65)
        .lpf(80)
        .attack(0.01)
        .decay(0.2)
        .sustain(0.5)
        .release(0.4)`,
      trip_hop: `note("<${safeKey}1 ~ ~ ${safeKey}1> <~ ${fourth}1 ~ ~> <${fifth}1 ~ ${safeKey}1 ~> <~ ~ ${fourth}1 ~>")
        .s("sine")
        .gain(0.7)
        .lpf(120)
        .attack(0.02)
        .decay(0.3)
        .sustain(0.6)
        .release(0.8)
        .room(0.3)`,
      boom_bap: `note("<${safeKey}1 ~ ${safeKey}1 ~> <${safeKey}1 ${fourth}1 ~ ~> <${safeKey}1 ~ ${fifth}1 ~> <${fourth}1 ~ ${safeKey}1 ~>")
        .s("sawtooth")
        .gain(0.7)
        .lpf(200)
        .attack(0.01)
        .decay(0.15)
        .sustain(0.4)
        .release(0.3)`
    };

    // Handle aliases
    // hasOwn, not `??`: STYLE_ALIASES is a plain object literal, so
    // STYLE_ALIASES['constructor'] returns Object and ['__proto__'] the
    // prototype. Neither is nullish, so `??` never fired and the result
    // was used as a string — TypeError, categorised `internal` (#295).
    const lowerStyle = String(style ?? '').toLowerCase();
    const resolvedStyle = Object.hasOwn(STYLE_ALIASES, lowerStyle)
      ? STYLE_ALIASES[lowerStyle]
      : lowerStyle;
    return lookup(patterns, resolvedStyle, patterns.techno);
  }

  /**
   * Generates a melodic pattern from a scale
   * @param scale - Array of note names to use
   * @param length - Number of notes in the melody (default: 8)
   * @param octaveRange - Tuple of min and max octave numbers (default: [3, 5])
   * @returns Strudel melody pattern code
   */
  generateMelody(scale: string[], length: number = 8, octaveRange: [number, number] = [3, 5]): string {
    const notes = [];
    let lastNoteIndex = Math.floor(Math.random() * scale.length);
    
    for (let i = 0; i < length; i++) {
      // Create more musical intervals (prefer steps over leaps)
      const stepProbability = 0.7;
      const useStep = Math.random() < stepProbability;
      
      let noteIndex: number;
      if (useStep) {
        // One scale degree, up or down. The comment used to claim "1 or
        // 2" while the code only ever moved by 1 (#324).
        const step = Math.random() < 0.5 ? 1 : -1;
        noteIndex = (lastNoteIndex + step + scale.length) % scale.length;
      } else {
        // Leap to any note
        noteIndex = Math.floor(Math.random() * scale.length);
      }
      
      const note = scale[noteIndex];
      const octave = octaveRange[0] + Math.floor(Math.random() * (octaveRange[1] - octaveRange[0] + 1));
      notes.push(`${note.toLowerCase()}${octave}`);
      lastNoteIndex = noteIndex;
    }
    
    return `note("${notes.join(' ')}").s("triangle")`;
  }

  /**
   * Generates a chord pattern from a progression
   * @param progression - Chord progression string
   * @param voicing - Chord voicing style (default: 'triad')
   * @returns Strudel chord pattern code
   */
  generateChords(progression: string, voicing: string = 'triad'): string {
    const voicings: Record<string, string> = {
      triad: '.struct("1 ~ ~ ~")',
      // `.add(note("7"))` transposes every note of the chord up 7
      // semitones — a perfect FIFTH, not a seventh. Strudel spells a
      // seventh chord in the chord symbol itself, so the honest fix is
      // to stop pretending this voicing adds one: it is a fifth-doubled
      // stab, and is now named for what it does. `seventh` is kept as
      // an alias so existing callers do not break, but it maps to the
      // same thing rather than to a lie (#324).
      fifths: '.struct("1 ~ ~ ~").add(note("7"))',
      seventh: '.struct("1 ~ ~ ~").add(note("7"))',
      sustained: '.attack(0.5).release(2)',
      stab: '.struct("1 ~ 1 ~").release(0.1)',
      pad: '.attack(2).release(4).room(0.8)'
    };
    
    return `note("<${progression}>").s("sawtooth")${lookup(voicings, voicing, voicings.triad)}`;
  }

  /**
   * Generates a complete multi-layer musical pattern
   * @param style - Music style (e.g., 'techno', 'house', 'jazz', 'ambient')
   * @param key - Musical key (default: 'C')
   * @param bpm - Tempo in beats per minute (default: 120)
   * @returns Complete Strudel pattern with drums, bass, chords, and melody
   */
  generateCompletePattern(style: string, key: string = 'C', bpm: number = 120): string {
    // Handle aliases and special genres
    // hasOwn, not `??`: STYLE_ALIASES is a plain object literal, so
    // STYLE_ALIASES['constructor'] returns Object and ['__proto__'] the
    // prototype. Neither is nullish, so `??` never fired and the result
    // was used as a string — TypeError, categorised `internal` (#295).
    const lowerStyle = String(style ?? '').toLowerCase();
    const resolvedStyle = Object.hasOwn(STYLE_ALIASES, lowerStyle)
      ? STYLE_ALIASES[lowerStyle]
      : lowerStyle;

    // Use specialized generators for new genres
    switch (resolvedStyle) {
      case 'intelligent_dnb':
        return this.generateIntelligentDnB(key, bpm || 170);
      case 'trip_hop':
        return this.generateTripHop(key, bpm || 90);
      case 'boom_bap':
        return this.generateBoomBap(key, bpm || 92);
    }

    // Default generation for other styles
    const drums = this.generateDrumPattern(resolvedStyle, 0.7);
    const bass = this.generateBassline(key, resolvedStyle);
    // Melody scale and chord progression must agree on mode.
    //
    // The scale was hardcoded to `minor` for everything except jazz,
    // while house / ambient / default got the `pop` progression — a
    // major I-V-vi-IV. So house in C produced <C G Am F> under a melody
    // of g#3 d#4 f4 c5 …, sounding Ab and Eb over C major and F major
    // triads (#324). Pick the progression first, then take the scale
    // that belongs to it.
    const chordStyle = resolvedStyle === 'jazz' ? 'jazz' :
                      resolvedStyle === 'house' ? 'pop' :
                      resolvedStyle === 'techno' ? 'edm' : 'pop';

    // The collection has to match the chords these are played over.
    //
    // `edm` and `modal` are minor progressions; `pop` is major. `jazz`
    // was 'dorian' "by convention" — and the convention is real, but it
    // names the mode of the ii CHORD, not of the key. Rooted on the key
    // it gave the wrong collection outright:
    //
    //   jazz progression in C  ->  Dm7 G7 Cmaj7   (diatonic ii-V-I in C major)
    //   melody scale           ->  C dorian = C D D# F G A A#
    //
    // Eb against Cmaj7's E, Bb against the B in both Cmaj7 and G7. The
    // bassline for the same style is `C2 E2 G2` — a major third — so two
    // of the three layers already agreed on major and the melody was the
    // odd one out (#449).
    //
    // D dorian and C major are the same seven notes; rooted on C, the
    // one that matches is `major`. This is the same defect the comment
    // above records fixing for house in #324, in the style it skipped.
    type ScaleName = Parameters<MusicTheory['generateScale']>[1];
    const scaleForChords: Record<string, ScaleName> = {
      jazz: 'major',
      pop: 'major',
      edm: 'minor',
      modal: 'minor',
    };
    const scale = this.theory.generateScale(
      key,
      lookup<ScaleName>(scaleForChords, chordStyle, 'minor'),
    );
    const melody = this.generateMelody(scale);

    const progression = this.theory.generateChordProgression(key, chordStyle as any);
    const chords = this.generateChords(progression, resolvedStyle === 'ambient' ? 'pad' : 'stab');
    
    // The header names what the drums actually are. `resolvedStyle` is
    // only alias-resolved, so an unknown genre stamped its own name over
    // a techno pattern (#279).
    const drumStyle = resolveDrumStyle(resolvedStyle);
    const header = drumStyle.supported
      ? `// ${drumStyle.resolved} pattern in ${key} at ${bpm} BPM`
      : `// ${drumStyle.resolved} pattern in ${key} at ${bpm} BPM` +
        ` (no drums defined for "${resolvedStyle}")`;

    return `${header}
setcpm(${bpm}/${String(BEATS_PER_CYCLE)})

stack(
  // Drums
  ${drums},
  
  // Bass
  ${bass},
  
  // Chords
  ${chords}.gain(0.6),
  
  // Melody
  ${melody}.struct("~ 1 ~ 1 1 ~ 1 ~").delay(0.25).room(0.3).gain(0.5)
).gain(0.8)`;
  }

  // ========================================
  // INTELLIGENT DNB GENERATOR
  // Style: LTJ Bukem, Good Looking Records
  // ========================================
  private generateIntelligentDnB(key: string, tempo: number): string {
    const safeKey = key.toLowerCase();
    const fourth = this.getFourth(safeKey);
    const seventh = this.getMinorSeventh(safeKey);
    const third = this.getMinorThird(safeKey);
    
    return `// Intelligent DnB in ${key} at ${tempo} BPM
// Style: LTJ Bukem / Good Looking Records
setcps(${tempo}/60/${String(BEATS_PER_CYCLE)})
samples('github:tidalcycles/dirt-samples')

let chords = chord("<${safeKey}m9 ${fourth}m9 ${seventh}m9 ${third}maj7>/4").dict('ireal')

stack(
  // === DRUMS - Rolling break with ghost notes ===
  s("breaks165")
    .fit()
    .slice(8, "0 0 6 3 0 2 6 7")
    .gain(0.7)
    .room(0.2),

  // Ghost break layer
  s("breaks165")
    .fit()
    .chop(16)
    .gain(0.12)
    .hpf(3000)
    .room(0.4)
    .pan(perlin.range(0.3, 0.7)),

  // Kick reinforcement
  s("bd ~ ~ ~ [~ bd] ~ bd ~")
    .bank("RolandTR909")
    .gain(0.45)
    .lpf(100),

  // Open hat accents
  s("~ ~ ~ oh ~ ~ oh ~")
    .bank("RolandTR909")
    .gain(0.28)
    .cut(1)
    .room(0.35),

  // === BASS - Deep sine sub ===
  note("<${safeKey}1 ~ ${safeKey}1 ~> <${fourth}1 ~ ~ ${fourth}1> <${seventh}0 ~ ${seventh}0 ~> <${third}1 ~ ~ ~>")
    .s("sine")
    .gain(0.65)
    .lpf(80)
    .attack(0.01)
    .decay(0.2)
    .sustain(0.5)
    .release(0.4),

  // === CHORDS - Jazz voicings ===
  chords.voicing()
    .s("gm_epiano1")
    .gain(0.3)
    .room(0.5)
    .delay(0.3)
    .delaytime(0.375)
    .delayfeedback(0.32)
    .lpf(4500),

  // === ATMOSPHERE - Ethereal strings ===
  chords.voicing()
    .s("gm_strings")
    .attack(2)
    .sustain(0.7)
    .release(3)
    .gain(0.18)
    .room(0.7)
    .size(0.85)
    .lpf(3000)
    .hpf(300)
)`;
  }

  // ========================================
  // TRIP HOP GENERATOR
  // Style: Portishead, Massive Attack, Flying Lotus
  // ========================================
  private generateTripHop(key: string, tempo: number): string {
    const safeKey = key.toLowerCase();
    const fourth = this.getFourth(safeKey);
    const fifth = this.getFifth(safeKey);
    const seventh = this.getMinorSeventh(safeKey);
    
    return `// Trip Hop in ${key} at ${tempo} BPM
// Style: Portishead / Massive Attack
setcps(${tempo}/60/${String(BEATS_PER_CYCLE)})

stack(
  // === DRUMS - Slow, heavy, dusty ===
  
  // Main beat - half time feel
  s("bd ~ [~ bd] ~ bd ~ ~ ~")
    .gain(0.85)
    .lpf(150)
    .room(0.3),

  // Snare - heavy with room
  s("~ ~ ~ ~ sd ~ ~ ~")
    .bank("RolandTR808")
    .gain(0.75)
    .room(0.5)
    .size(0.6),

  // Ghost snares
  s("~ ~ ~ sd:3? ~ ~ sd:2? ~")
    .bank("RolandTR808")
    .gain(0.2)
    .room(0.4),

  // Dusty hats
  s("hh*8")
    .gain(perlin.range(0.15, 0.3))
    .hpf(5000)
    .room(0.3)
    .pan(perlin.range(0.3, 0.7).slow(4)),

  // === BASS - Deep and moody ===
  note("<${safeKey}1 ~ ~ ${safeKey}1> <~ ${fourth}1 ~ ~> <${fifth}1 ~ ${safeKey}1 ~> <~ ~ ${fourth}1 ~>")
    .s("sine")
    .gain(0.7)
    .lpf(120)
    .attack(0.02)
    .decay(0.3)
    .sustain(0.6)
    .release(0.8)
    .room(0.3),

  // === KEYS - Dark Rhodes ===
  chord("<${safeKey}m7 ${fourth}m7 ${fifth}m7 ${seventh}maj7>/4")
    .dict('ireal')
    .voicing()
    .s("gm_epiano1")
    .gain(0.25)
    .room(0.5)
    .lpf(2500)
    .delay(0.4)
    .delaytime(0.666)
    .delayfeedback(0.35),

  // === ATMOSPHERE - Dark pad ===
  chord("<${safeKey}m7 ${fourth}m7>/8")
    .dict('ireal')
    .voicing()
    .s("sawtooth")
    .attack(3)
    .sustain(0.6)
    .release(4)
    .lpf(sine.range(300, 800).slow(16))
    .lpq(0.5)
    .gain(0.12)
    .room(0.8)
    .size(0.9),

  // === TEXTURE - Vinyl crackle vibe ===
  s("hh:8*16")
    .gain(0.03)
    .hpf(8000)
    .room(0.2)
)`;
  }

  // ========================================
  // BOOM BAP GENERATOR
  // Style: DJ Premier, Alchemist, Daringer, Hit-Boy
  // ========================================
  private generateBoomBap(key: string, tempo: number): string {
    const safeKey = key.toLowerCase();
    const fourth = this.getFourth(safeKey);
    const fifth = this.getFifth(safeKey);
    const seventh = this.getMinorSeventh(safeKey);
    const minorThird = this.getMinorThird(safeKey);
    
    return `// Boom Bap in ${key} at ${tempo} BPM
// Style: DJ Premier / Alchemist / Daringer
setcps(${tempo}/60/${String(BEATS_PER_CYCLE)})

stack(
  // === DRUMS - Hard hitting, swing ===
  
  // Main kick pattern
  s("bd ~ ~ [~ bd] sd ~ ~ ~, bd ~ ~ bd sd ~ [bd bd] ~")
    .gain(0.9)
    .lpf(200)
    .room(0.15),

  // Layered snare for crack
  s("~ ~ ~ ~ sd:3 ~ ~ ~")
    .gain(0.35)
    .hpf(200)
    .room(0.25),

  // Crispy hats
  s("[~ hh]*8")
    .gain(0.5)
    .hpf(4000)
    .room(0.2),

  // Open hat accents
  s("~ ~ oh ~ ~ ~ ~ oh:2")
    .gain(0.3)
    .room(0.35)
    .cut(1),

  // === BASS - Punchy and warm ===
  note("<${safeKey}1 ~ ${safeKey}1 ~> <${safeKey}1 ${fourth}1 ~ ~> <${safeKey}1 ~ ${fifth}1 ~> <${fourth}1 ~ ${safeKey}1 ~>")
    .s("sawtooth")
    .gain(0.65)
    .lpf(180)
    .attack(0.01)
    .decay(0.15)
    .sustain(0.4)
    .release(0.3),

  // === CHOPS - Soul sample style ===
  chord("<${safeKey}m7 ~ ${fourth}m7 ~> <${seventh}maj7 ~ ${minorThird}maj7 ~>/2")
    .dict('ireal')
    .voicing()
    .s("gm_epiano1")
    .gain(0.4)
    .room(0.3)
    .lpf(3000)
    .hpf(200),

  // === STRINGS - Cinematic stabs ===
  chord("<${safeKey}m7 ~ ~ ~> <~ ~ ${fourth}m7 ~>/4")
    .dict('ireal')
    .voicing()
    .s("gm_strings")
    .struct("1 ~ ~ ~ ~ 1? ~ ~")
    .attack(0.1)
    .release(0.8)
    .gain(0.25)
    .room(0.4)
    .lpf(4000)
    .hpf(300),

  // === HORNS - Optional stab ===
  note("<${safeKey}4 ${minorThird}4 ${fourth}4 ${safeKey}4>/8")
    .s("gm_brass")
    .struct("~ ~ ~ ~ 1 ~ ~ ~")
    .gain(0.2)
    .room(0.3)
    .lpf(3500)
).swing(0.08)`;
  }

  /**
   * Generates variations on an existing pattern
   * @param pattern - Original pattern code
   * @param variationType - Type of variation ('subtle', 'moderate', 'extreme', 'glitch', 'evolving')
   * @returns Pattern with variation modifiers applied
   */
  generateVariation(pattern: string, variationType: string = 'subtle'): string {
    const variations: Record<string, string> = {
      subtle: '.sometimes(x => x.fast(2))',
      moderate: '.every(4, x => x.rev).sometimes(x => x.fast(2))',
      extreme: '.every(2, x => x.jux(rev)).sometimes(x => x.iter(4))',
      glitch: '.sometimes(x => x.chop(8).rev).rarely(x => x.speed(-1))',
      evolving: '.slow(4).every(8, x => x.fast(2)).every(16, x => x.palindrome)'
    };
    
    return pattern + lookup(variations, variationType, variations.subtle);
  }

  /**
   * Generates a drum fill for transitions
   * @param style - Music style for the fill
   * @param bars - Length of the fill in bars (default: 1)
   * @returns Strudel fill pattern code
   */
  generateFill(style: string, bars: number = 1): string {
    const fills: Record<string, string> = {
      techno: `s("bd*8, cp*4").fast(${bars})`,
      house: `s("bd*4, cp*2, hh*16").fast(${bars})`,
      dnb: `s("bd*8, sn*8").fast(${bars * 2})`,
      trap: `s("bd*4, hh*32").fast(${bars})`,
      breakbeat: `s("bd cp bd cp, hh*8").iter(4).fast(${bars})`,
      intelligent_dnb: `s("breaks165").fit().slice(16, "0 2 4 6 8 10 12 14 1 3 5 7 9 11 13 15").gain(0.7).fast(${bars})`,
      trip_hop: `s("bd ~ sd ~, hh*4").room(0.5).fast(${bars})`,
      boom_bap: `s("bd sd bd sd, hh*8").swing(0.1).fast(${bars})`
    };
    
    return lookup(fills, style, fills.techno);
  }

  /**
   * Generates a transition between two musical styles
   * @param fromStyle - Starting music style
   * @param toStyle - Target music style
   * @param bars - Length of transition in bars (default: 4)
   * @returns Strudel transition pattern with crossfade
   */
  generateTransition(fromStyle: string, toStyle: string, bars: number = 4): string {
    return `// Transition from ${fromStyle} to ${toStyle}
stack(
  // Fade out ${fromStyle}
  ${this.generateDrumPattern(fromStyle, 0.5)}.gain(perlin.range(0.8, 0).slow(${bars})),
  
  // Fade in ${toStyle}
  ${this.generateDrumPattern(toStyle, 0.5)}.gain(perlin.range(0, 0.8).slow(${bars}))
)`;
  }

  /**
   * Generates a Euclidean rhythm pattern
   * @param hits - Number of hits in the pattern
   * @param steps - Total number of steps
   * @param sound - Sound name to use (default: "bd")
   * @returns Strudel Euclidean pattern code
   */
  generateEuclideanPattern(hits: number, steps: number, sound: string = "bd"): string {
    const rhythm = this.theory.generateEuclideanRhythm(hits, steps);
    return `s("${sound}").struct("${rhythm}")`;
  }

  /**
   * Generates a polyrhythmic pattern with multiple Euclidean rhythms
   * @param sounds - Array of sound names to use
   * @param patterns - Array of hit counts for each rhythm
   * @returns Strudel polyrhythm pattern code
   * @throws {Error} When sounds and patterns arrays have different lengths
   */
  generatePolyrhythm(sounds: string[], patterns: number[]): string {
    if (sounds.length !== patterns.length) {
      throw new ValidationError('Number of sounds must match number of patterns');
    }
    
    const rhythms = sounds.map((sound, i) => {
      return `s("${sound}").euclid(${patterns[i]}, 16)`;
    });
    
    return `stack(\n  ${rhythms.join(',\n  ')}\n)`;
  }
}
