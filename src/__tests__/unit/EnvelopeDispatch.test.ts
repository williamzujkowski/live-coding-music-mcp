/**
 * Tests for the MCP protocol-level result envelope (#130).
 *
 * These exercise `StrudelMCPServer.dispatchToolCall` — the wrapper that
 * turns raw tool returns and thrown errors into the shared envelope
 * shape every MCP client now sees. Unit-test scope; integration tests
 * cover the full request/response wire.
 */

// StrudelMCPServer transitively imports @strudel/* (ESM). Jest's CJS loader
// can't load that; use the mock that already exists for unit tests.
jest.mock('../../services/StrudelEngine');

import { StrudelMCPServer } from '../../server/server';
import {
  categorizeError,
  empty,
  err,
  isEnvelope,
  ok,
} from '../../server/tools/types';

describe('envelope helpers', () => {
  describe('ok', () => {
    it('returns the success shape', () => {
      const e = ok('hi');
      expect(e).toEqual({ ok: true, data: 'hi' });
      expect(isEnvelope(e)).toBe(true);
    });
  });

  describe('empty', () => {
    it('marks the result as valid-empty', () => {
      const e = empty([]);
      expect(e).toEqual({ ok: true, data: [], empty: true });
    });
  });

  describe('err', () => {
    it('defaults isRetryable false for non-transient categories', () => {
      const e = err('validation', 'bad input');
      expect(e).toEqual({
        ok: false,
        errorCategory: 'validation',
        isRetryable: false,
        message: 'bad input',
      });
    });

    it('defaults isRetryable true for transient', () => {
      const e = err('transient', 'timeout');
      expect(e.isRetryable).toBe(true);
    });

    it('honours explicit isRetryable override', () => {
      expect(err('validation', 'x', { isRetryable: true }).isRetryable).toBe(true);
      expect(err('transient', 'x', { isRetryable: false }).isRetryable).toBe(false);
    });

    it('includes partialResult when provided', () => {
      const e = err('internal', 'half-done', { partialResult: { progress: 0.5 } });
      expect(e).toMatchObject({
        ok: false,
        partialResult: { progress: 0.5 },
      });
    });
  });

  describe('isEnvelope', () => {
    it('recognises ok envelopes', () => {
      expect(isEnvelope({ ok: true, data: 'x' })).toBe(true);
    });
    it('recognises err envelopes', () => {
      expect(isEnvelope({ ok: false, errorCategory: 'business', isRetryable: false, message: 'x' })).toBe(true);
    });
    it('rejects raw strings and arbitrary objects', () => {
      expect(isEnvelope('hello')).toBe(false);
      expect(isEnvelope({ ok: 'truthy-but-not-bool' })).toBe(false);
      expect(isEnvelope({ data: 'no ok field' })).toBe(false);
      expect(isEnvelope(null)).toBe(false);
      expect(isEnvelope(undefined)).toBe(false);
    });
  });

  describe('categorizeError', () => {
    it('maps init phrases to business', () => {
      expect(categorizeError(new Error('Browser not initialized. Run init first.'))).toBe('business');
      expect(categorizeError(new Error("Pattern 'foo' not found"))).toBe('business');
      expect(categorizeError(new Error("Session 'bar' already exists"))).toBe('business');
    });

    it('maps input phrases to validation', () => {
      expect(categorizeError(new Error('Invalid BPM: 5000'))).toBe('validation');
      expect(categorizeError(new Error('BPM must be 20-300'))).toBe('validation');
      expect(categorizeError(new Error('Style is required'))).toBe('validation');
      expect(categorizeError(new Error('out of range'))).toBe('validation');
    });

    it('maps auth/api phrases to permission', () => {
      expect(categorizeError(new Error('Gemini API key not set'))).toBe('permission');
      expect(categorizeError(new Error('Unauthorized'))).toBe('permission');
    });

    it('maps network phrases to transient', () => {
      expect(categorizeError(new Error('Request timeout after 5s'))).toBe('transient');
      expect(categorizeError(new Error('ECONNREFUSED'))).toBe('transient');
      expect(categorizeError(new Error('fetch failed'))).toBe('transient');
    });

    it('falls back to internal', () => {
      expect(categorizeError(new Error('something we have never seen'))).toBe('internal');
      expect(categorizeError('non-error thrown')).toBe('internal');
    });
  });
});

describe('StrudelMCPServer.dispatchToolCall', () => {
  let server: any;

  beforeEach(() => {
    server = new StrudelMCPServer();
  });

  it('wraps a raw string return into ok(...)', async () => {
    server.executeTool = jest.fn().mockResolvedValue('Loaded pattern "x"');
    const e = await server.dispatchToolCall('load', { name: 'x' });
    expect(e).toEqual({ ok: true, data: 'Loaded pattern "x"' });
  });

  it('wraps a raw object return into ok(...)', async () => {
    server.executeTool = jest.fn().mockResolvedValue({ bpm: 174, confidence: 0.92 });
    const e = await server.dispatchToolCall('detect_tempo', {});
    expect(e).toEqual({ ok: true, data: { bpm: 174, confidence: 0.92 } });
  });

  it('converts legacy "Browser not initialized..." string into err(business)', async () => {
    server.executeTool = jest
      .fn()
      .mockResolvedValue('Browser not initialized. Run init first.');
    const e = await server.dispatchToolCall('play', {});
    expect(e).toEqual({
      ok: false,
      errorCategory: 'business',
      isRetryable: false,
      message: 'Browser not initialized. Run init first.',
    });
  });

  it('converts legacy "Error: ..." string into err(internal)', async () => {
    server.executeTool = jest.fn().mockResolvedValue('Error: something blew up');
    const e = await server.dispatchToolCall('write', { pattern: 'x' });
    expect(e).toMatchObject({
      ok: false,
      errorCategory: 'internal',
      message: 'something blew up',
    });
  });

  it('passes pre-built envelopes through unchanged', async () => {
    const passthrough = err('permission', 'GEMINI_API_KEY missing');
    server.executeTool = jest.fn().mockResolvedValue(passthrough);
    const e = await server.dispatchToolCall('get_pattern_feedback', {});
    expect(e).toBe(passthrough);
  });

  it('passes pre-built ok(...) envelopes through unchanged', async () => {
    const passthrough = ok({ x: 1 });
    server.executeTool = jest.fn().mockResolvedValue(passthrough);
    const e = await server.dispatchToolCall('analyze', {});
    expect(e).toBe(passthrough);
  });

  it('catches thrown Error and categorises by message', async () => {
    server.executeTool = jest.fn().mockRejectedValue(new Error('Invalid BPM: 5000'));
    const e = await server.dispatchToolCall('set_tempo', { bpm: 5000 });
    expect(e).toEqual({
      ok: false,
      errorCategory: 'validation',
      isRetryable: false,
      message: 'Invalid BPM: 5000',
    });
  });

  it('catches non-Error throws and reports them as internal', async () => {
    server.executeTool = jest.fn().mockRejectedValue('plain string thrown');
    const e = await server.dispatchToolCall('whatever', {});
    expect(e.ok).toBe(false);
    if (!e.ok) {
      expect(e.errorCategory).toBe('internal');
      expect(e.message).toBe('plain string thrown');
    }
  });
});
