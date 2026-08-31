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
import { BusinessError, TransientError, ValidationError } from '../../utils/CategorisedError';
import { AiAuthError } from '../../services/ai/AiTransport';

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

  it('treats unparseable model output as worth retrying', () => {
    // "No JSON found in response" means the model wrote prose where a
    // JSON block was asked for. The next attempt often does not, and the
    // message contains no word the matcher recognises — so it landed in
    // `internal` and told the caller not to bother.
    expect(categorizeError(new TransientError('No JSON found in response'))).toBe('transient');
  });

  it('treats an auth failure as permission, whatever it says', () => {
    // `permission` was reachable only by matching "not authenticated",
    // "api key", "unauthorized" and five more phrases. AiAuthError is
    // thrown by CliTransport and now carries the verdict itself.
    // Deliberately says nothing the matcher recognises. The first
    // version of this said "gemini rejected the request" and passed with
    // the instanceof check removed — because `gemini` was in the
    // permission list, making every error that mentioned the vendor a
    // credentials problem. Removing that entry is half of this fix.
    expect(categorizeError(new AiAuthError('the transport declined'))).toBe('permission');
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
  const FIXED: [string, 'validation' | 'business' | 'transient'][] = [
    ['Steps cannot exceed', 'validation'],
    ['cannot exceed steps', 'validation'],
    ['Number of sounds must match', 'validation'],
    ['reserved filename', 'validation'],
    ['Pattern exceeds maximum length', 'validation'],
    ['MIDI base64 input too large', 'validation'],
    ['MIDI input too large', 'validation'],
    ['Maximum session limit', 'business'],
    ['No JSON found in response', 'transient'],
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
    const wanted = { validation: 'ValidationError', business: 'BusinessError', transient: 'TransientError' };
    expect(site.cls).toBe(wanted[expected]);
  });
});

describe('the category survives the dispatcher (#382)', () => {
  /**
   * The unit tests above prove the type carries a verdict and the throw
   * sites use it. Neither proves the verdict SURVIVES the trip out.
   *
   * Cross-model review (agy) found it did not: `session.ts` caught the
   * error, kept only `.message`, and returned `{ success: false, error }`
   * — which the dispatcher turned back into a plain `new Error(message)`
   * before categorising. The type was destroyed one frame above the
   * code that reads it, so the fix was a no-op on exactly the path it
   * was written for.
   */
  it('a business failure from a tool reaches the caller as business', async () => {
    const { execute } = await import('../../server/tools/session');
    const ctx = {
      sessionManager: {
        createSession: () => { throw new BusinessError('Maximum session limit (5) reached.'); },
        getSessionCount: () => 5,
        getMaxSessions: () => 5,
      },
    } as never;

    const result = (await execute('session', { action: 'create', session_id: 'x' }, ctx)) as {
      ok: boolean; errorCategory: string; isRetryable: boolean;
    };
    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('business');
    expect(result.isRetryable).toBe(false);
  });

  it('an unrecognised failure from the same path is still internal', () => {
    // The seam must preserve the category, not invent one.
    expect(categorizeError(new Error('something nobody anticipated'))).toBe('internal');
  });
});
