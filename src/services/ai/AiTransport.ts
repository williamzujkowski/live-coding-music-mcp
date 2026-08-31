/**
 * AiTransport — the one thing that varies between AI providers.
 *
 * `GeminiService` grew ~950 lines around a single provider, but almost
 * none of it is provider-specific: prompt building, JSON parsing, caching,
 * rate limiting and the response contracts are all provider-agnostic. The
 * genuinely variable part is one operation — get a prompt to a model and
 * get text back.
 *
 * So that is the whole seam:
 *
 *     type AiTransport = (prompt: string) => Promise<string>
 *
 * Two implementations satisfy it: an HTTP call to the Gemini API, and a
 * subprocess call to a locally authenticated CLI (`agy`, `claude`,
 * `codex`). Everything above the seam stays exactly where it is, which is
 * also why the ~80 existing tests keep working.
 *
 * ## Why there is no audio attachment parameter
 *
 * There was going to be one. It turned out none of the installed CLIs can
 * actually hear audio — verified by asking each directly:
 *
 *   agy    -> "I CANNOT PERCEIVE AUDIO DIRECTLY"
 *   codex  -> "CANNOT DECODE AUDIO"
 *   claude -> "CANNOT DECODE AUDIO"
 *
 * `agy` is the dangerous one: as an agentic CLI it will sometimes write
 * and run DSP code, producing exactly correct numbers, and sometimes just
 * describe plausible-sounding music it never analysed. A differential
 * probe caught it reporting a clipped file as clean and a clean file as
 * clipped. Right often enough to trust, wrong unpredictably, is the worst
 * property an automated feedback loop can have.
 *
 * The answer is to not ask a model to hear. We already measure the audio
 * locally (`AudioAnalyzer` for FFT/tempo/key, `AudioExportService` for
 * peak/RMS) and send the *numbers* as text. That is deterministic, and it
 * works with every provider rather than one — so the transport only ever
 * needs to carry text.
 *
 * @module services/ai/AiTransport
 */

/** Sends a prompt to a model and returns its raw text response. */
export type AiTransport = (prompt: string) => Promise<string>;

/** How a transport identifies itself, for diagnostics and cache keys. */
export interface TransportInfo {
  /** Stable id, e.g. `gemini-api` or `cli:agy`. */
  id: string;
  /** Human-readable description for error messages. */
  label: string;
}

/** A transport plus the metadata needed to select and report on it. */
export interface AiTransportEntry extends TransportInfo {
  /** Whether this transport can currently serve a request. */
  isAvailable(): Promise<boolean>;
  send: AiTransport;
}

/** Raised when a transport cannot authenticate. */
export class AiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiAuthError';
  }
}

/** Raised when a transport is rate limited. */
export class AiRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiRateLimitError';
  }
}
