/**
 * AudioMeasurements — describing audio to a model that cannot hear it.
 *
 * The obvious design was to hand a WAV to a multimodal model. That does
 * not work here: none of the installed CLIs can decode audio. Asked
 * directly, they say so —
 *
 *   agy    -> "I CANNOT PERCEIVE AUDIO DIRECTLY"
 *   codex  -> "CANNOT DECODE AUDIO"
 *   claude -> "CANNOT DECODE AUDIO"
 *
 * `agy` is the dangerous one. Being agentic, it sometimes writes and runs
 * DSP code and returns exactly correct figures, and sometimes just
 * describes plausible music it never analysed. A differential probe
 * caught it calling a clipped file clean and a clean file clipped. Right
 * often enough to trust, wrong unpredictably, is the worst possible
 * property for an automated feedback loop.
 *
 * So we do not ask a model to listen. We measure the audio ourselves —
 * `AudioExportService` already computes peak and RMS while decoding, and
 * `AudioAnalyzer` computes FFT bands, spectral centroid, tempo and key —
 * and send the numbers as text.
 *
 * That inverts the constraint into an advantage. Measurement is
 * deterministic and reproducible, the model does the part it is actually
 * good at (interpretation and musical judgement), and it works with every
 * provider rather than one.
 *
 * @module services/ai/AudioMeasurements
 */

/** Everything measured locally about a captured window of audio. */
export interface AudioMeasurements {
  /** Recorded window in ms. */
  durationMs: number;
  /** Peak amplitude in [0,1]; above 1.0 means the mix is clipping. */
  peak?: number;
  /** RMS amplitude in [0,1] — perceived loudness. */
  rms?: number;
  sampleRate?: number;
  channels?: number;
  /** Detected tempo and how much to trust it. */
  tempo?: { bpm: number; confidence: number };
  /** Detected key and how much to trust it. */
  key?: { key: string; scale: string; confidence: number };
  /** Spectral balance, 0-255 per band as reported by the analyser. */
  spectrum?: {
    bass: number; lowMid: number; mid: number; highMid: number; treble: number;
    centroid: number; brightness: string;
  };
  /** Rhythmic character. */
  rhythm?: { complexity: number; density: number; syncopation: number };
}

/** Converts a linear amplitude to dBFS, the unit mixing engineers use. */
export function toDbfs(amplitude: number): number {
  if (amplitude <= 0) return -Infinity;
  return 20 * Math.log10(amplitude);
}

/**
 * Renders measurements as text a model can reason about.
 *
 * Deliberately states units and interpretation rather than dumping raw
 * numbers: "peak 1.12 (CLIPPING)" gets a useful answer where "peak: 1.12"
 * invites the model to guess what scale that is on.
 *
 * @param m - Locally computed measurements
 * @returns Human- and model-readable measurement block
 */
export function describeMeasurements(m: AudioMeasurements): string {
  const lines: string[] = [];

  lines.push(`- Duration: ${String(Math.round(m.durationMs))} ms`);

  if (m.sampleRate !== undefined) {
    lines.push(`- Format: ${String(m.sampleRate)} Hz, ${String(m.channels ?? 2)} channel(s)`);
  }

  if (m.peak !== undefined) {
    const db = toDbfs(m.peak);
    const verdict = m.peak > 1
      ? 'CLIPPING — above full scale, so the mix is distorting'
      : m.peak > 0.95
        ? 'very close to full scale, little headroom'
        : `${(-db).toFixed(1)} dB of headroom`;
    lines.push(`- Peak: ${m.peak.toFixed(4)} (${db.toFixed(2)} dBFS) — ${verdict}`);
  }

  if (m.rms !== undefined) {
    lines.push(
      `- RMS: ${m.rms.toFixed(4)} (${toDbfs(m.rms).toFixed(2)} dBFS) — perceived loudness`
    );
  }

  if (m.peak !== undefined && m.rms !== undefined && m.rms > 0) {
    const crest = toDbfs(m.peak / m.rms);
    lines.push(
      `- Crest factor: ${crest.toFixed(1)} dB — ` +
      (crest < 6 ? 'heavily compressed / dense' : crest > 15 ? 'very dynamic / sparse' : 'moderate dynamics')
    );
  }

  if (m.tempo !== undefined) {
    lines.push(
      `- Detected tempo: ${String(Math.round(m.tempo.bpm))} BPM ` +
      `(confidence ${m.tempo.confidence.toFixed(2)})`
    );
  }

  if (m.key !== undefined) {
    lines.push(
      `- Detected key: ${m.key.key} ${m.key.scale} ` +
      `(confidence ${m.key.confidence.toFixed(2)})`
    );
  }

  if (m.spectrum !== undefined) {
    const s = m.spectrum;
    lines.push(
      `- Spectrum (0-255): bass ${String(Math.round(s.bass))}, ` +
      `low-mid ${String(Math.round(s.lowMid))}, mid ${String(Math.round(s.mid))}, ` +
      `high-mid ${String(Math.round(s.highMid))}, treble ${String(Math.round(s.treble))}`
    );
    lines.push(
      `- Spectral centroid: ${String(Math.round(s.centroid))} Hz (${s.brightness})`
    );
  }

  if (m.rhythm !== undefined) {
    lines.push(
      `- Rhythm: complexity ${m.rhythm.complexity.toFixed(2)}, ` +
      `density ${m.rhythm.density.toFixed(2)}, syncopation ${m.rhythm.syncopation.toFixed(2)}`
    );
  }

  return lines.join('\n');
}

/**
 * Builds the audio-feedback prompt from measurements plus the pattern.
 *
 * The pattern source matters as much as the numbers: it lets the model
 * connect a measurement to the line that caused it, which is the
 * difference between "the mix is clipping" and "these three layers sum
 * above 1.0, lower them".
 *
 * @param m - Locally computed measurements
 * @param pattern - The Strudel source that produced the audio
 * @param context - Optional intent (style/bpm/key the user was aiming for)
 * @returns Prompt text for any model
 */
export function buildMeasurementPrompt(
  m: AudioMeasurements,
  pattern?: string,
  context?: { style?: string; bpm?: number; key?: string },
): string {
  const parts: string[] = [
    'You are analysing a short recording of a live-coded music performance made with Strudel.',
    '',
    'These measurements were computed directly from the audio signal. They are',
    'accurate — treat them as ground truth rather than re-estimating them.',
    '',
    describeMeasurements(m),
  ];

  if (pattern !== undefined && pattern.trim().length > 0) {
    parts.push('', 'The Strudel pattern that produced it:', '```javascript', pattern.trim(), '```');
  }

  if (context !== undefined) {
    const intent: string[] = [];
    if (context.style !== undefined) intent.push(`intended style: ${context.style}`);
    if (context.bpm !== undefined) intent.push(`intended BPM: ${String(context.bpm)}`);
    if (context.key !== undefined) intent.push(`intended key: ${context.key}`);
    if (intent.length > 0) parts.push('', `Intent — ${intent.join(', ')}.`);
  }

  parts.push(
    '',
    'Respond with ONLY this JSON object and no other text:',
    '{',
    '  "mood": "<one word, e.g. energetic, hypnotic, melancholic>",',
    '  "style": "<musical genre you infer>",',
    '  "energy": "<low|medium|high>",',
    '  "suggestions": ["<specific, actionable change>", "<another>", "<another>"],',
    '  "confidence": <0.0-1.0>',
    '}',
    '',
    'Ground every suggestion in a measurement or a line of the pattern. If the',
    'audio is clipping, say so first and name the layers responsible. Do not',
    'claim to have heard timbral detail the measurements do not support.',
  );

  return parts.join('\n');
}
