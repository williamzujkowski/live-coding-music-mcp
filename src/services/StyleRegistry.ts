/**
 * Which styles exist, and what a caller actually gets when they ask for
 * one that doesn't.
 *
 * This lives apart from PatternGenerator on purpose. It is pure data
 * plus one lookup — the tool layer needs it to *describe* a result
 * honestly, which is a different job from generating the result. Keeping
 * it separate also means a test that mocks the generator still gets real
 * style facts rather than `undefined`.
 *
 * Background (#279): an unknown genre silently fell back to techno while
 * every layer above echoed the requested style back, so an agent asking
 * for vaporwave was told it received vaporwave — in the metadata, the
 * message, and the pattern's own header comment.
 */

/**
 * Alias → canonical style.
 *
 * Three near-copies of this table lived inline in generateDrumPattern /
 * generateBassline / generateCompletePattern, and they had drifted: the
 * bassline copy was missing `atmospheric`, `flying_lotus`, `alchemist`,
 * `daringer` and `hitboy`, so compose("flying_lotus") produced trip-hop
 * drums over a techno bassline.
 */
export const STYLE_ALIASES: Record<string, string> = {
  liquid_dnb: 'intelligent_dnb',
  atmospheric_dnb: 'intelligent_dnb',
  intelligent: 'intelligent_dnb',
  liquid: 'intelligent_dnb',
  atmospheric: 'intelligent_dnb',
  bukem: 'intelligent_dnb',
  triphop: 'trip_hop',
  portishead: 'trip_hop',
  massive_attack: 'trip_hop',
  flying_lotus: 'trip_hop',
  'drum and bass': 'dnb',
  'drum-and-bass': 'dnb',
  boombap: 'boom_bap',
  golden_era: 'boom_bap',
  premier: 'boom_bap',
  alchemist: 'boom_bap',
  daringer: 'boom_bap',
  hitboy: 'boom_bap',
};

/**
 * Styles with a drum pattern of their own. Anything else — `jazz`
 * included, despite being documented as a style — takes techno drums.
 */
export const DRUM_STYLES: readonly string[] = [
  'techno', 'house', 'dnb', 'breakbeat', 'trap', 'jungle',
  'ambient', 'experimental', 'intelligent_dnb', 'trip_hop', 'boom_bap',
];

/**
 * Styles with a bassline of their own. A different set from
 * `DRUM_STYLES`, which is the whole problem: `jazz` has a bassline but
 * no drums, and `breakbeat` / `trap` / `jungle` / `experimental` have
 * drums but no bassline. Reporting one collapsed `style` had to lie in
 * one direction or the other (#294).
 */
export const BASS_STYLES: readonly string[] = [
  'techno', 'house', 'dnb', 'acid', 'dub', 'funk', 'jazz', 'ambient',
  'intelligent_dnb', 'trip_hop', 'boom_bap',
];

/** What `resolveDrumStyle` reports back. */
export interface StyleResolution {
  /** Exactly what the caller passed. */
  requested: string;
  /** The style whose drums will actually play. */
  resolved: string;
  /** False when `resolved` is a substitution rather than the request. */
  supported: boolean;
}

/**
 * Resolves a caller's style to one that actually has drums.
 *
 * @param style - Style or alias the caller asked for
 * @returns The request, what will really be used, and whether they match
 * @example
 * resolveDrumStyle('bukem');     // → intelligent_dnb, supported
 * resolveDrumStyle('vaporwave'); // → techno, not supported
 */
export function resolveDrumStyle(style: string): StyleResolution {
  const lower = String(style ?? '').toLowerCase();
  // hasOwn, not `?? lower`: STYLE_ALIASES is a plain object literal, so
  // STYLE_ALIASES['constructor'] returns Object and STYLE_ALIASES['__proto__']
  // returns the prototype — neither is nullish, so `??` never fires (#295).
  const resolved = Object.hasOwn(STYLE_ALIASES, lower) ? STYLE_ALIASES[lower] : lower;
  const supported = DRUM_STYLES.includes(resolved);
  return { requested: style, resolved: supported ? resolved : 'techno', supported };
}

/**
 * Resolves a caller's style for the bassline layer.
 *
 * @param style - Style or alias the caller asked for
 * @returns The request, the bassline that will really play, and whether they match
 */
export function resolveBassStyle(style: string): StyleResolution {
  const lower = String(style ?? '').toLowerCase();
  const resolved = Object.hasOwn(STYLE_ALIASES, lower) ? STYLE_ALIASES[lower] : lower;
  const supported = BASS_STYLES.includes(resolved);
  return { requested: style, resolved: supported ? resolved : 'techno', supported };
}

/** Per-layer breakdown of what a requested style actually produces. */
export interface LayerResolution {
  /** Exactly what the caller asked for. */
  requested: string;
  /** The style whose material each layer actually uses. */
  layers: { drums: string; bass: string; chords: string; scale: string };
  /** Layers whose style is a substitution rather than the request. */
  substituted: string[];
}

/**
 * Describes what a requested style really produces, layer by layer.
 *
 * `compose` assembles a pattern from four independently-resolved
 * layers, each falling back on its own. One `style` field cannot
 * describe that: reporting the drum resolution called
 * compose({style:'jazz'}) "techno" even though the bassline, Dorian
 * scale and jazz chord progression are all genuinely jazz, while
 * `breakbeat` reported itself supported with a techno bassline
 * underneath (#294).
 *
 * @param style - Style or alias the caller asked for
 * @returns What each layer will actually use, and which ones were substituted
 * @example
 * resolveLayers('jazz');
 * // layers: { drums: 'techno', bass: 'jazz', chords: 'jazz', scale: 'dorian' }
 * // substituted: ['drums']
 */
export function resolveLayers(style: string): LayerResolution {
  const drums = resolveDrumStyle(style);
  const bass = resolveBassStyle(style);
  const canonical = drums.supported ? drums.resolved : bass.resolved;

  // Mirrors PatternGenerator.generateCompletePattern: chord family and
  // scale are derived from the resolved style, not looked up, so they
  // never "fall back" — but the caller still wants to know what they are.
  const lower = String(style ?? '').toLowerCase();
  const resolved = Object.hasOwn(STYLE_ALIASES, lower) ? STYLE_ALIASES[lower] : lower;
  const chords = resolved === 'jazz' ? 'jazz' : resolved === 'house' ? 'pop'
    : resolved === 'techno' ? 'edm' : 'pop';
  const scale = resolved === 'jazz' ? 'dorian' : 'minor';

  const substituted: string[] = [];
  if (!drums.supported) substituted.push('drums');
  if (!bass.supported) substituted.push('bass');

  void canonical;
  return {
    requested: style,
    layers: { drums: drums.resolved, bass: bass.resolved, chords, scale },
    substituted,
  };
}

/**
 * Default BPM per canonical style.
 *
 * This lived in compose.ts and disagreed with the style tables in both
 * directions (#296). It had no entry for `intelligent_dnb`, `trip_hop`
 * or `boom_bap`, so those three fell to 120 — and because compose
 * passes that 120 down, the generator's own `bpm || 170` fallback was
 * never reached: compose({style:'bukem'}) produced
 * "// Intelligent DnB in C at 120 BPM". Meanwhile it carried
 * 'drum and bass' at 174, a style STYLE_ALIASES had never heard of, so
 * that request became 174-BPM techno.
 *
 * Lookup happens after alias resolution now, so `bukem` gets
 * intelligent_dnb's tempo. A test asserts every key here is a style the
 * registry actually knows.
 */
export const TEMPO_BY_STYLE: Record<string, number> = {
  techno: 130,
  house: 125,
  dnb: 174,
  ambient: 80,
  trap: 140,
  jungle: 160,
  jazz: 110,
  experimental: 120,
  breakbeat: 130,
  // The three specialized genres, which had no entry at all.
  intelligent_dnb: 170,
  trip_hop: 90,
  boom_bap: 92,
  // Styles with a bassline but no drums of their own.
  acid: 130,
  dub: 140,
  funk: 110,
  // Tempo-only: see TEMPO_ONLY_STYLES.
  dubstep: 140,
  trance: 138,
  garage: 130,
  electro: 128,
  downtempo: 90,
  idm: 115,
};

/**
 * Styles that have a sensible tempo but no drums or bassline of their
 * own. A caller asking for one gets that tempo with techno material,
 * and `resolveLayers` reports both layers as substituted — so the
 * result is honest, and these are listed rather than left to look like
 * an oversight.
 *
 * Anything here is a candidate for real content; adding it to
 * DRUM_STYLES or BASS_STYLES without the content will fail the registry
 * accuracy test in PerLayerStyleReporting.
 */
export const TEMPO_ONLY_STYLES: readonly string[] = [
  'dubstep', 'trance', 'garage', 'electro', 'downtempo', 'idm',
];

/** Default BPM for a style, resolving aliases first. */
export function defaultTempoFor(style: string): number {
  const lower = String(style ?? '').toLowerCase();
  const resolved = Object.hasOwn(STYLE_ALIASES, lower) ? STYLE_ALIASES[lower] : lower;
  // hasOwn throughout, for the reason in #295: TEMPO_BY_STYLE is a plain
  // object literal, so TEMPO_BY_STYLE['__proto__'] returns the prototype
  // and `?? 120` never fires.
  if (Object.hasOwn(TEMPO_BY_STYLE, resolved)) return TEMPO_BY_STYLE[resolved];
  if (Object.hasOwn(TEMPO_BY_STYLE, lower)) return TEMPO_BY_STYLE[lower];
  return 120;
}
