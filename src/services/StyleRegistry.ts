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
  const resolved = STYLE_ALIASES[lower] ?? lower;
  const supported = DRUM_STYLES.includes(resolved);
  return { requested: style, resolved: supported ? resolved : 'techno', supported };
}
