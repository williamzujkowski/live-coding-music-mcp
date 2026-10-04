/**
 * ServerConfig - parsing and validation for config.json
 *
 * `config.json` shipped four keys and the code read two of them.
 * `strudel_url` and `patterns_dir` were documented in the README as
 * working and silently ignored (#227), so anyone pointing the server at a
 * self-hosted Strudel build, or at an existing pattern library, got the
 * defaults with no warning and went debugging the wrong thing.
 *
 * Silently-ignored configuration is worse than none: it actively misleads.
 * So this module both reads the keys and warns about ones it does not
 * recognise, which is what stops the next dead key from being silent.
 *
 * @module utils/ServerConfig
 * @nist si-10 "Information input validation"
 */

import * as path from 'path';
import type { AudioAnalysisConfig } from '../types/AudioAnalysis.js';

/** Default Strudel REPL, used when `strudel_url` is absent or unusable. */
export const DEFAULT_STRUDEL_URL = 'https://strudel.cc/';

/** Default on-disk pattern library. */
export const DEFAULT_PATTERNS_DIR = './patterns';

/** Every key config.json may contain. Anything else earns a warning. */
const KNOWN_KEYS = new Set([
  'headless',
  'strudel_url',
  'patterns_dir',
  'exports_dir',
  'audio_analysis',
  'viewport',
  'block_resources',
]);

/** Playwright viewport size. `null` means "track the OS window size". */
export interface ViewportConfig {
  width: number;
  height: number;
}

/**
 * Default page setup, unchanged from the historic hardcoding (#514).
 *
 * Both values exist for headless CI: a pinned viewport keeps
 * screenshots deterministic, and aborting fonts and images speeds up
 * page load. In a headed window the same choices degrade the live
 * editor (fallback-font button metrics, canvases that ignore window
 * resizes), which is why both are now configurable.
 */
export const DEFAULT_VIEWPORT: ViewportConfig = { width: 1280, height: 720 };

/** Resource types the page route aborts by default (#514). */
export const DEFAULT_BLOCK_RESOURCES: readonly string[] = ['image', 'font', 'media'];

/**
 * Resource types Playwright may report; `block_resources` values are
 * validated against this set so a typo earns a warning instead of a
 * silently unblocked resource class.
 */
const KNOWN_RESOURCE_TYPES = new Set([
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'texttrack',
  'xhr',
  'fetch',
  'eventsource',
  'websocket',
  'manifest',
  'other',
]);

/**
 * Browser page-setup overrides threaded from config.json to the
 * Playwright launch sites (#514). Absent fields mean "use the default".
 */
export interface BrowserFidelity {
  viewport?: ViewportConfig | null;
  blockResources?: readonly string[];
}

/** Validated configuration, with defaults applied. */
export interface ServerConfig {
  headless: boolean;
  strudelUrl: string;
  patternsDir: string;
  exportsDir?: string;
  audioAnalysis?: AudioAnalysisConfig;
  /** Playwright viewport; null lets the page track the OS window size (#514). */
  viewport: ViewportConfig | null;
  /** Resource types the page route aborts to speed up load (#514). */
  blockResources: string[];
  /** Human-readable problems found while parsing; caller logs these. */
  warnings: string[];
}

/**
 * Validates a Strudel URL.
 *
 * The value reaches `page.goto()`, so restrict it to http/https rather
 * than letting `file:`, `javascript:` or similar through.
 *
 * @param value - Raw `strudel_url` from config.json
 * @param warnings - Collector for problems found
 * @returns A usable URL, falling back to the default
 * @nist si-10 "Information input validation"
 */
function parseStrudelUrl(value: unknown, warnings: string[]): string {
  if (value === undefined) return DEFAULT_STRUDEL_URL;

  if (typeof value !== 'string' || value.trim().length === 0) {
    warnings.push(
      `config.strudel_url must be a non-empty string; using ${DEFAULT_STRUDEL_URL}`
    );
    return DEFAULT_STRUDEL_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    warnings.push(`config.strudel_url is not a valid URL: ${value}; using ${DEFAULT_STRUDEL_URL}`);
    return DEFAULT_STRUDEL_URL;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    warnings.push(
      `config.strudel_url must use http or https, got '${parsed.protocol}'; ` +
      `using ${DEFAULT_STRUDEL_URL}`
    );
    return DEFAULT_STRUDEL_URL;
  }

  return value;
}

/**
 * Validates a directory path from config.
 *
 * @param value - Raw value from config.json
 * @param key - Key name, for the warning message
 * @param fallback - Value to use when unusable
 * @param warnings - Collector for problems found
 * @returns A usable directory path
 */
function parseDirectory(
  value: unknown,
  key: string,
  fallback: string,
  warnings: string[],
): string {
  if (value === undefined) return fallback;

  if (typeof value !== 'string' || value.trim().length === 0) {
    warnings.push(`config.${key} must be a non-empty string; using ${fallback}`);
    return fallback;
  }

  return path.resolve(value);
}

/**
 * Parses raw config.json contents into validated settings.
 *
 * Never throws: a bad value falls back to its default and records a
 * warning, so a typo in config.json cannot stop the server from starting.
 *
 * @param raw - Parsed contents of config.json, or undefined if absent
 * @returns Validated config plus any warnings to log
 *
 * @example
 * const config = parseServerConfig({ strudel_url: 'file:///etc/passwd' });
 * // -> strudelUrl: 'https://strudel.cc/', warnings: ['...must use http or https...']
 */
/** Keys `audio_analysis` may contain. Anything else earns a warning. */
const KNOWN_AUDIO_KEYS = new Set(['fft_size', 'smoothing']);

/**
 * Parses the `audio_analysis` block, saying so when it cannot.
 *
 * Three ways this used to go wrong in silence, all measured:
 *
 *   audio_analysis: "enabled"      -> undefined, indistinguishable from
 *                                     leaving the block out entirely
 *   audio_analysis: []             -> {} — an array passes a bare
 *                                     `typeof === 'object'` test
 *   audio_analysis: {fftSize: ...} -> {} — the natural camelCase
 *                                     spelling of `fft_size`, dropped
 *
 * The last is the sharpest: the same typo one level up IS warned about
 * by the unknown-key loop above, so the file was strict about its own
 * keys and silent about the nested ones (#442).
 */
function parseAudioAnalysis(
  raw: unknown,
  warnings: string[],
): { fftSize?: number; smoothing?: number } | undefined {
  if (raw === undefined) return undefined;

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(
      'config.audio_analysis must be an object with fft_size and/or smoothing; ignoring it'
    );
    return undefined;
  }

  const audio = raw as Record<string, unknown>;
  for (const key of Object.keys(audio)) {
    if (!KNOWN_AUDIO_KEYS.has(key)) {
      warnings.push(
        `Unknown config key 'audio_analysis.${key}' — it will be ignored. ` +
        `Known keys: ${[...KNOWN_AUDIO_KEYS].join(', ')}`
      );
    }
  }
  if (audio.fft_size !== undefined && typeof audio.fft_size !== 'number') {
    warnings.push('config.audio_analysis.fft_size must be a number; ignoring it');
  }
  if (audio.smoothing !== undefined && typeof audio.smoothing !== 'number') {
    warnings.push('config.audio_analysis.smoothing must be a number; ignoring it');
  }

  return {
    fftSize: typeof audio.fft_size === 'number' ? audio.fft_size : undefined,
    smoothing: typeof audio.smoothing === 'number' ? audio.smoothing : undefined,
  };
}

/**
 * Parses the `viewport` block (#514).
 *
 * `null` is meaningful, not missing: Playwright treats a null viewport
 * as "use the real window size", which is what makes window resizes
 * reach the page. A malformed value falls back to the pinned default
 * rather than to null, so a typo cannot silently unpin the layout in
 * headless runs.
 */
function parseViewport(raw: unknown, warnings: string[]): ViewportConfig | null {
  if (raw === undefined) return DEFAULT_VIEWPORT;
  if (raw === null) return null;

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const vp = raw as Record<string, unknown>;
    if (
      typeof vp.width === 'number' &&
      typeof vp.height === 'number' &&
      Number.isFinite(vp.width) &&
      Number.isFinite(vp.height) &&
      vp.width > 0 &&
      vp.height > 0
    ) {
      return { width: vp.width, height: vp.height };
    }
  }

  warnings.push(
    'config.viewport must be null or an object with positive numeric width and height; ' +
      `using ${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}`
  );
  return DEFAULT_VIEWPORT;
}

/**
 * Parses the `block_resources` array (#514).
 *
 * An empty array is valid and means "abort nothing" — the live-coding
 * recommendation is `["media"]`, keeping large audio fetches out while
 * letting fonts and images render.
 */
function parseBlockResources(raw: unknown, warnings: string[]): string[] {
  if (raw === undefined) return [...DEFAULT_BLOCK_RESOURCES];

  const valid =
    Array.isArray(raw) &&
    raw.every((t): t is string => typeof t === 'string' && KNOWN_RESOURCE_TYPES.has(t));
  if (valid) return [...raw];

  warnings.push(
    'config.block_resources must be an array of Playwright resource types ' +
      `(${[...KNOWN_RESOURCE_TYPES].join(', ')}); using ` +
      `[${DEFAULT_BLOCK_RESOURCES.map((t) => `'${t}'`).join(', ')}]`
  );
  return [...DEFAULT_BLOCK_RESOURCES];
}

export function parseServerConfig(raw: unknown): ServerConfig {
  const warnings: string[] = [];
  const obj: Record<string, unknown> =
    raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    warnings.push('config.json must contain a JSON object; using defaults');
  }

  // A key nothing reads is how #227 happened. Say so rather than ignore it.
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push(
        `Unknown config key '${key}' — it will be ignored. ` +
        `Known keys: ${[...KNOWN_KEYS].join(', ')}`
      );
    }
  }

  if (obj.headless !== undefined && typeof obj.headless !== 'boolean') {
    warnings.push(`config.headless must be a boolean; using false`);
  }

  const audioAnalysis = parseAudioAnalysis(obj.audio_analysis, warnings);

  return {
    headless: obj.headless === true,
    strudelUrl: parseStrudelUrl(obj.strudel_url, warnings),
    patternsDir: parseDirectory(obj.patterns_dir, 'patterns_dir', DEFAULT_PATTERNS_DIR, warnings),
    exportsDir:
      obj.exports_dir === undefined
        ? undefined
        : parseDirectory(obj.exports_dir, 'exports_dir', './exports', warnings),
    audioAnalysis,
    viewport: parseViewport(obj.viewport, warnings),
    blockResources: parseBlockResources(obj.block_resources, warnings),
    warnings,
  };
}
