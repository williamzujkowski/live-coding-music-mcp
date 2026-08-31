/**
 * Shared pattern fixtures.
 *
 * This file used to export twelve fixtures and one was imported. The
 * other eleven — `musicalContexts`, `drumPatterns`, `basslinePatterns`,
 * `testMetadata`, `audioFeatures`, `mcpRequests`, `errorScenarios`,
 * `performanceMetrics`, `createTestPattern`, `createTestPatternData`,
 * `generateRandomPattern` — had no caller anywhere, and two of them
 * shadowed unrelated names elsewhere in the repo, so a grep for them
 * looked like a hit (#378).
 *
 * Dead test infrastructure is worse than dead production code: it reads
 * as a shared vocabulary the suite has agreed on, so the next person
 * writing a test reaches for it, finds it does not fit, and builds their
 * own — which is how there came to be eleven of these.
 */
export const samplePatterns = {
  simple: 's("bd*4")',

  techno: `s("bd*4, ~ cp ~ cp, hh*8").room(0.2)`,

  house: `stack(
  s("bd*4"),
  s("~ cp ~ cp"),
  s("[~ hh]*4")
).gain(0.8)`,

  dnb: `stack(
  s("bd ~ ~ bd ~ ~ bd ~"),
  s("~ ~ cp ~ ~ cp ~ ~"),
  s("hh*16")
).fast(2)`,

  withBass: `stack(
  s("bd*4, ~ cp ~ cp"),
  note("c2 c2 c2 c2").s("sawtooth").cutoff(800)
)`,

  complex: `setcpm(130/4)

stack(
  // Drums
  s("bd*4, ~ cp ~ cp, [~ hh]*4").room(0.2),

  // Bass
  note("c2 c2 c2 c2").s("sawtooth").cutoff(800),

  // Melody
  note("c4 e4 g4 e4").s("triangle").struct("~ 1 ~ 1").delay(0.25)
).gain(0.8)`,

  euclidean: `s("bd").euclid(5, 8)`,

  polyrhythm: `stack(
  s("bd").euclid(3, 16),
  s("cp").euclid(5, 16),
  s("hh").euclid(7, 16)
)`,

  withEffects: `s("bd*4").room(0.9).delay(0.5).gain(0.7)`,

  invalid: `this is not valid strudel code`,

  syntaxError: `s("bd*4"`,

  empty: '',

  veryLong: 's("bd*4")' + '.sometimes(x => x.fast(2))'.repeat(50)
};
