/**
 * Errors that know their category say so (#382).
 *
 * `categorizeError` decides retryability by matching phrases. Anything
 * unrecognised falls through to `internal`, which is not retryable and
 * reads to an agent as "the server is broken". An audit of every
 * `throw new Error(...)` in `src/` put 47 messages there, and at least
 * eleven were plainly the caller's input — "Steps cannot exceed 256",
 * "Hits (9) cannot exceed steps (8)", "MIDI input too large".
 *
 * Growing the matcher was the alternative, and it is a treadmill: that
 * would have been the fourth phrase patched in after the fact, after
 * the `'timed out'` vs `'timeout'` fix and the dead rate-limit class of
 * #380.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { categorizeError } from '../../server/tools/types';
import { BusinessError, ValidationError } from '../../utils/CategorisedError';

describe('categorised errors carry their own verdict (#382)', () => {
  it('treats a validation failure as the caller\'s to fix', () => {
    // Deliberately worded with none of the phrases the matcher looks
    // for. That is the whole point of the type.
    expect(categorizeError(new ValidationError('Steps cannot exceed 256, got 512'))).toBe('validation');
    expect(categorizeError(new ValidationError('Hits (9) cannot exceed steps (8)'))).toBe('validation');
  });

  it('treats a business failure as setup, not breakage', () => {
    expect(categorizeError(new BusinessError('Maximum session limit (5) reached.'))).toBe('business');
  });

  it('still falls back to the message for errors we did not construct', () => {
    // A dependency's error has no type of ours. The matcher stays.
    expect(categorizeError(new Error('request timed out'))).toBe('transient');
    expect(categorizeError(new Error('Invalid BPM: 900'))).toBe('validation');
  });

  it('does not sweep genuine programmer errors out of internal', () => {
    // "Unknown tool" means the dispatcher was handed something that
    // should not exist. That IS internal, and must stay there.
    expect(categorizeError(new Error('Unknown tool: nonsense'))).toBe('internal');
    expect(categorizeError(new Error('analysis module does not handle tool: x'))).toBe('internal');
  });
});

describe('the throw sites that were miscategorised stay fixed (#382)', () => {
  const SOURCE_DIR = path.join(__dirname, '..', '..');

  /** Every `throw new X('...')` in src, excluding tests and mocks. */
  function throwSites(dir = SOURCE_DIR, acc: { cls: string; message: string; file: string }[] = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
        throwSites(full, acc);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const text = readFileSync(full, 'utf8');
      for (const m of text.matchAll(/throw new (\w+)\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) {
        acc.push({
          cls: m[1],
          message: m[2].slice(1, -1).replace(/\$\{[^}]*\}/g, 'X'),
          file: path.relative(SOURCE_DIR, full),
        });
      }
    }
    return acc;
  }

  const SITES = throwSites();

  /** The messages this issue named. Each must no longer be `internal`. */
  const FIXED: [string, 'validation' | 'business'][] = [
    ['Steps cannot exceed', 'validation'],
    ['cannot exceed steps', 'validation'],
    ['Number of sounds must match', 'validation'],
    ['reserved filename', 'validation'],
    ['Pattern exceeds maximum length', 'validation'],
    ['MIDI base64 input too large', 'validation'],
    ['MIDI input too large', 'validation'],
    ['Refusing to render', 'validation'],
    ['Maximum session limit', 'business'],
    ['has no active page yet', 'business'],
  ];

  it('finds the throw sites', () => {
    expect(SITES.length).toBeGreaterThan(80);
  });

  it.each(FIXED)('%s is thrown as a typed error', (needle, expected) => {
    const site = SITES.find(s => s.message.includes(needle));
    expect(site).toBeDefined();
    if (site === undefined) return;
    // The class name is what carries the category, so assert on it rather
    // than re-running the matcher over a message that would pass for
    // the wrong reason.
    expect(site.cls).toBe(expected === 'validation' ? 'ValidationError' : 'BusinessError');
  });
});
