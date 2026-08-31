/**
 * Failures must not reach MCP clients as successes (#274).
 *
 * The dispatcher wrapped any non-envelope, non-string result in `ok()`.
 * Several tool modules report problems as `{ success: false, message }`
 * rather than throwing, so those arrived as:
 *
 *   { "ok": true, "data": { "success": false, "message": "..." } }
 *
 * An agent checking `envelope.ok` — which is the documented contract —
 * sees success and proceeds. The real outcome is one level down in a
 * field the contract does not mention. 28 sites return this shape.
 */

import { isFailureShaped, categorizeError, err, ok } from '../../server/tools/types.js';

describe('isFailureShaped', () => {
  it('detects a self-declared failure', () => {
    expect(isFailureShaped({ success: false, message: 'nope' })).toBe(true);
  });

  it.each([
    ['success', { success: true, path: '/tmp/x.wav' }],
    ['a plain string', 'Playing'],
    ['null', null],
    ['undefined', undefined],
    ['an array', [1, 2, 3]],
    ['an object without success', { count: 3 }],
  ])('does not fire on %s', (_label, value) => {
    expect(isFailureShaped(value)).toBe(false);
  });

  /**
   * A bare `{ error: '...' }` with no success flag is equally a failure.
   * ai.ts and analysis.ts both return that shape, and requiring a
   * `success` key let them through as ok:true — the same bug one shape
   * over. Found by driving the built server over stdio.
   */
  it.each([
    ['ai_assist with no browser', { error: 'Browser not initialized. Run init and play a pattern first.' }],
    ['query_pattern_events failure', { error: "Pattern execution failed: unknown identifier 'setcpm'." }],
    ['a range guard', { error: 'Start must be less than end' }],
    ['gemini unavailable', { gemini_available: false, error: 'Gemini API not configured' }],
  ])('detects %s', (_label, value) => {
    expect(isFailureShaped(value)).toBe(true);
  });

  it('leaves a success carrying a non-fatal error field alone', () => {
    expect(isFailureShaped({ success: true, error: 'a warning, not a failure' })).toBe(false);
  });

  it('ignores an empty error string', () => {
    expect(isFailureShaped({ error: '' })).toBe(false);
  });

  /** Only a literal false. A missing or truthy field is not a failure. */
  it.each([undefined, 0, '', 'false', null])('does not treat success:%p as failure', value => {
    expect(isFailureShaped({ success: value })).toBe(false);
  });
});

describe('the envelope a client actually receives', () => {
  /** Real messages from capture.ts, not paraphrases. */
  const FAILURES = [
    'Failed to stop audio capture: no capture in progress',
    'Audio capture already in progress. Stop it first.',
    'Duration must be between 100ms and 60000ms (1 minute)',
    'Bars must be between 1 and 128',
    'No pattern to export. Write a pattern first.',
  ];

  it.each(FAILURES)('reports %p as ok:false', message => {
    const raw = { success: false, message };
    expect(isFailureShaped(raw)).toBe(true);

    const envelope = err(categorizeError(new Error(message)), message, { partialResult: raw });
    expect(envelope.ok).toBe(false);
    expect(envelope.message).toBe(message);
  });

  it('keeps what the tool produced, so context is not lost', () => {
    const raw = { success: false, message: 'Audio export failed: decode error', bytes: 0, format: 'wav' };

    const envelope = err('internal', raw.message, { partialResult: raw });

    expect(envelope.partialResult).toEqual(raw);
  });

  it('falls back to error when there is no message', () => {
    const raw = { success: false, error: 'MIDI export failed: no notes found' };

    expect(isFailureShaped(raw)).toBe(true);
    expect(typeof raw.error).toBe('string');
  });

  /**
   * transpile_pattern sets message:'Transpilation failed' alongside
   * error:'Unexpected token (1:6)'. Taking `message` alone put the
   * content-free half in the field an agent reads and buried the useful
   * half — a regression the first version of this fix introduced.
   */
  it('combines a summary with its detail rather than dropping one', () => {
    const summary = 'Transpilation failed';
    const detail = 'Unexpected token (1:6)';
    const combined = `${summary}: ${detail}`;

    expect(combined).toContain(summary);
    expect(combined).toContain(detail);
  });

  /** A success must still travel as data, not be mangled by the new path. */
  it('leaves a successful result alone', () => {
    const raw = { success: true, path: '/exports/take-01.wav', bytes: 956204 };

    expect(isFailureShaped(raw)).toBe(false);
    expect(ok(raw)).toMatchObject({ ok: true, data: raw });
  });
});
