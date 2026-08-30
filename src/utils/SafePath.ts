/**
 * SafePath - filename sanitization and directory confinement for file writes
 *
 * Every filename this server writes to disk originates in MCP tool
 * arguments, which are model-generated. Anything that reaches an agent's
 * context — a web page it summarized, a pattern it loaded, a MIDI file it
 * imported — can therefore steer a path. Confining writes is not
 * defense against the user; it is defense against the user's agent being
 * talked into something.
 *
 * `PatternStore.sanitizeFilename()` already did this correctly for saved
 * patterns. The export paths did not: `MIDIExportService.exportToFile()`
 * called bare `resolve(filename)` (#224) and `takeScreenshot()` had an
 * inverted guard that passed any filename *containing* a separator
 * through unsanitized (#234). This module is the shared implementation so
 * there is one place to get it right.
 *
 * Behaviour is *neutralize, then report* rather than throw: a traversal
 * attempt is reduced to a safe basename and `wasModified` is set, so the
 * caller can tell the agent where the file actually landed. Failing
 * silently would let a model believe it wrote to `../../secrets/x.mid`;
 * failing loudly on every odd character would make ordinary filenames
 * unusable. Reporting the real path does both jobs.
 *
 * @module utils/SafePath
 * @nist si-10 "Information input validation"
 * @nist ac-3 "Access enforcement"
 */

import * as path from 'path';

/** Outcome of sanitizing and resolving a requested output path. */
export interface SafeOutputPath {
  /** Sanitized basename, including extension. */
  filename: string;
  /** Absolute path, guaranteed to sit directly inside `directory`. */
  path: string;
  /** True when the requested name was altered (traversal, bad chars, ...). */
  wasModified: boolean;
  /** The caller's original request, present only when it was modified. */
  requested?: string;
}

/** Options for {@link resolveSafeOutputPath}. */
export interface SafeOutputPathOptions {
  /** Directory writes are confined to. Resolved against cwd if relative. */
  directory: string;
  /** Required extension, with leading dot (e.g. `.mid`). */
  extension: string;
  /** Name used when the caller supplies none. */
  defaultName: string;
}

/** Windows device names, which are unusable as files even on POSIX shares. */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

const MAX_STEM_LENGTH = 100;

/**
 * Reduces an arbitrary string to a safe filename stem.
 *
 * Strips every path component, then replaces anything outside
 * `[A-Za-z0-9._-]` so separators, null bytes, and shell metacharacters
 * cannot survive in any encoding.
 *
 * @param requested - Caller-supplied name
 * @param extension - Extension to strip before sanitizing
 * @returns Safe stem, or empty string if nothing usable remained
 */
function sanitizeStem(requested: string, extension: string): string {
  // basename first: strips `../`, absolute roots, and Windows separators
  // once path.basename has normalized them.
  let stem = path.basename(requested.replace(/\\/g, '/'));

  if (stem.toLowerCase().endsWith(extension.toLowerCase())) {
    stem = stem.slice(0, -extension.length);
  }

  stem = stem.replace(/[^A-Za-z0-9._-]/g, '_');

  // A name that is only dots would resolve back to a directory.
  stem = stem.replace(/^\.+/, '');

  if (RESERVED_NAMES.has(stem.toLowerCase())) {
    stem = `_${stem}`;
  }

  return stem.slice(0, MAX_STEM_LENGTH);
}

/**
 * Sanitizes a requested filename and confines it to a directory.
 *
 * @param requested - Caller-supplied filename, possibly hostile or absent
 * @param options - Target directory, required extension, and default name
 * @returns The resolved path plus whether the request had to be altered
 * @throws {Error} If the result would escape `directory` — a belt-and-braces
 *   check that should be unreachable after sanitization
 *
 * @example
 * resolveSafeOutputPath('../../etc/passwd', {
 *   directory: './exports', extension: '.mid', defaultName: 'pattern.mid',
 * });
 * // -> { filename: 'passwd.mid', wasModified: true, path: '<cwd>/exports/passwd.mid' }
 *
 * @nist si-10 "Information input validation"
 * @nist ac-3 "Access enforcement"
 */
export function resolveSafeOutputPath(
  requested: string | undefined,
  options: SafeOutputPathOptions,
): SafeOutputPath {
  const { directory, extension, defaultName } = options;
  const root = path.resolve(directory);

  const stem = requested ? sanitizeStem(requested, extension) : '';
  const filename = stem.length > 0 ? `${stem}${extension}` : defaultName;

  const resolved = path.resolve(root, filename);

  // Should be unreachable — sanitizeStem removes every separator — but a
  // containment check is cheap and this is the last line before a write.
  if (path.dirname(resolved) !== root) {
    throw new Error(
      `Refusing to write outside the export directory: ${String(requested)}`
    );
  }

  const wasModified = requested !== undefined && requested !== filename;

  return {
    filename,
    path: resolved,
    wasModified,
    ...(wasModified ? { requested } : {}),
  };
}

/**
 * Directory exports are written to.
 *
 * Defaults to `./exports`, overridable via `exports_dir` in config.json.
 *
 * @param configuredDir - Value of `exports_dir`, if set
 * @returns Absolute export directory path
 */
export function resolveExportDirectory(configuredDir?: unknown): string {
  return path.resolve(
    typeof configuredDir === 'string' && configuredDir.trim().length > 0
      ? configuredDir
      : './exports'
  );
}
