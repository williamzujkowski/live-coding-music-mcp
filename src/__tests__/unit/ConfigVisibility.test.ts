/**
 * A configuration problem the user cannot see is worse than none (#442).
 *
 * `ServerConfig.ts`'s own header says that, and yet three things in the
 * `audio_analysis` block failed in silence, measured:
 *
 *     audio_analysis: "enabled"       -> undefined, no warning —
 *                                        indistinguishable from omitting it
 *     audio_analysis: []              -> {} — an array passes a bare
 *                                        `typeof === 'object'` test
 *     audio_analysis: {fftSize: 2048} -> {} — the natural camelCase
 *                                        spelling of `fft_size`, dropped
 *
 * The last is the sharpest: the same typo one level up IS warned about
 * by the unknown-key loop, so the parser was strict about its own keys
 * and silent about the nested ones.
 *
 * And every warning it did produce went to `logger.warn` and nowhere a
 * caller could read it.
 */

import { parseServerConfig } from '../../utils/ServerConfig';
import { execute } from '../../server/tools/diagnostics';
import type { ToolContext } from '../../server/tools/types';

describe('the audio_analysis block reports what it ignored (#442)', () => {
  it.each([
    ['a string', 'enabled'],
    ['an array', []],
    ['null', null],
  ])('warns when the block is %s', (_label, value) => {
    const { audioAnalysis, warnings } = parseServerConfig({ audio_analysis: value });

    expect(audioAnalysis).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/audio_analysis must be an object/);
  });

  it('warns about a nested key nothing reads', () => {
    // camelCase is the spelling a reader would guess, and it was dropped
    // without a word.
    const { warnings } = parseServerConfig({ audio_analysis: { fftSize: 2048 } });

    expect(warnings.join(' ')).toMatch(/audio_analysis\.fftSize/);
  });

  it('warns when a nested value is the wrong type', () => {
    const { warnings } = parseServerConfig({ audio_analysis: { fft_size: 'big' } });

    expect(warnings.join(' ')).toMatch(/fft_size must be a number/);
  });

  it('says nothing about a correct block', () => {
    // The warnings must stay worth reading.
    const { audioAnalysis, warnings } = parseServerConfig({
      audio_analysis: { fft_size: 2048, smoothing: 0.8 },
    });

    expect(audioAnalysis).toEqual({ fftSize: 2048, smoothing: 0.8 });
    expect(warnings).toEqual([]);
  });

  it('says nothing when the block is absent', () => {
    expect(parseServerConfig({}).warnings).toEqual([]);
  });
});

describe('diagnostics reports which config was read (#442)', () => {
  function ctxWith(report: ToolContext['configReport']): ToolContext {
    return {
      configReport: report,
      isInitialized: () => true,
      getController: () => ({ getStatus: () => ({ playing: false }) }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    } as unknown as ToolContext;
  }

  it('reports the path and any warnings', async () => {
    const result = await execute('diagnostics', { level: 'status' }, ctxWith({
      path: '/somewhere/config.json',
      found: true,
      warnings: ["Unknown config key 'strudelUrl' — it will be ignored."],
    })) as { config: { path: string; found: boolean; warnings: string[] } };

    expect(result.config.path).toBe('/somewhere/config.json');
    expect(result.config.found).toBe(true);
    expect(result.config.warnings[0]).toMatch(/strudelUrl/);
  });

  it('reports the path even when no file was found', async () => {
    // The cwd surprise this exists for: a client launching the server
    // from elsewhere silently gets defaults, and this is how the user
    // sees WHICH path was checked.
    const result = await execute('diagnostics', { level: 'status' }, ctxWith({
      path: '/wrong/cwd/config.json',
      found: false,
      warnings: [],
    })) as { config: { found: boolean; warnings?: string[] } };

    expect(result.config.found).toBe(false);
    // No warnings key when there is nothing to say.
    expect(result.config.warnings).toBeUndefined();
  });

  it('keeps the controller status it used to return', async () => {
    const result = await execute('diagnostics', { level: 'status' }, ctxWith({
      path: '/c.json', found: true, warnings: [],
    })) as { playing: boolean };

    expect(result.playing).toBe(false);
  });
});
