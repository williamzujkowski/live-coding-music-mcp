/**
 * Config parsing tests (#227).
 *
 * `config.json` shipped four keys and the code read two. `strudel_url`
 * and `patterns_dir` were documented in the README as working and
 * silently ignored, so anyone pointing the server at a self-hosted
 * Strudel build, or at an existing pattern library, got the defaults with
 * no warning and went debugging the wrong thing.
 */

import * as path from 'path';
import {
  parseServerConfig,
  DEFAULT_STRUDEL_URL,
  DEFAULT_PATTERNS_DIR,
} from '../../utils/ServerConfig.js';

describe('parseServerConfig', () => {
  describe('strudel_url (#227)', () => {
    it('is actually read, not ignored', () => {
      expect(parseServerConfig({ strudel_url: 'http://localhost:3000/' }).strudelUrl)
        .toBe('http://localhost:3000/');
    });

    it('defaults when absent', () => {
      expect(parseServerConfig({}).strudelUrl).toBe(DEFAULT_STRUDEL_URL);
    });

    /**
     * The value reaches page.goto(), so a non-http scheme must not get
     * through — file:// would point the browser at the local filesystem.
     */
    it.each([
      ['file:///etc/passwd', 'file:'],
      ['javascript:alert(1)', 'javascript:'],
      ['data:text/html,<script>1</script>', 'data:'],
    ])('rejects %s and falls back', (url, _scheme) => {
      const config = parseServerConfig({ strudel_url: url });

      expect(config.strudelUrl).toBe(DEFAULT_STRUDEL_URL);
      expect(config.warnings.join(' ')).toMatch(/http or https/);
    });

    it.each([['', 'empty'], [42, 'number'], [null, 'null'], [{}, 'object']])(
      'falls back for a %p value',
      value => {
        const config = parseServerConfig({ strudel_url: value });

        expect(config.strudelUrl).toBe(DEFAULT_STRUDEL_URL);
        expect(config.warnings.length).toBeGreaterThan(0);
      },
    );

    it('warns rather than throwing on an unparseable URL', () => {
      const config = parseServerConfig({ strudel_url: 'not a url' });

      expect(config.strudelUrl).toBe(DEFAULT_STRUDEL_URL);
      expect(config.warnings.join(' ')).toMatch(/not a valid URL/);
    });
  });

  describe('patterns_dir (#227)', () => {
    it('is actually read, not ignored', () => {
      expect(parseServerConfig({ patterns_dir: '/srv/patterns' }).patternsDir)
        .toBe('/srv/patterns');
    });

    it('resolves a relative path', () => {
      expect(parseServerConfig({ patterns_dir: './my-patterns' }).patternsDir)
        .toBe(path.resolve('./my-patterns'));
    });

    it('defaults when absent', () => {
      expect(parseServerConfig({}).patternsDir).toBe(DEFAULT_PATTERNS_DIR);
    });

    it('warns and falls back on a non-string', () => {
      const config = parseServerConfig({ patterns_dir: 42 });

      expect(config.patternsDir).toBe(DEFAULT_PATTERNS_DIR);
      expect(config.warnings.join(' ')).toMatch(/patterns_dir/);
    });
  });

  describe('unknown keys', () => {
    /** The failure mode that let #227 sit unnoticed. */
    it('warns about a key nothing reads', () => {
      const config = parseServerConfig({ strudel_urls: 'https://example.com/' });

      expect(config.warnings.join(' ')).toMatch(/Unknown config key 'strudel_urls'/);
    });

    it('lists the known keys so the typo is fixable', () => {
      const warning = parseServerConfig({ nonsense: 1 }).warnings.join(' ');

      expect(warning).toMatch(/strudel_url/);
      expect(warning).toMatch(/patterns_dir/);
    });

    it('stays quiet when every key is known', () => {
      const config = parseServerConfig({
        headless: true,
        strudel_url: 'https://strudel.cc/',
        patterns_dir: './patterns',
        exports_dir: './exports',
        audio_analysis: { fft_size: 2048, smoothing: 0.8 },
      });

      expect(config.warnings).toEqual([]);
    });
  });

  describe('existing behaviour is preserved', () => {
    it('reads headless', () => {
      expect(parseServerConfig({ headless: true }).headless).toBe(true);
      expect(parseServerConfig({}).headless).toBe(false);
    });

    it('translates audio_analysis to camelCase (#195)', () => {
      expect(parseServerConfig({ audio_analysis: { fft_size: 2048, smoothing: 0.5 } }).audioAnalysis)
        .toEqual({ fftSize: 2048, smoothing: 0.5 });
    });

    it('normalizes non-numeric audio_analysis values to undefined', () => {
      expect(parseServerConfig({ audio_analysis: { fft_size: 'big' } }).audioAnalysis)
        .toEqual({ fftSize: undefined, smoothing: undefined });
    });

    it('leaves audioAnalysis undefined when the key is absent', () => {
      expect(parseServerConfig({}).audioAnalysis).toBeUndefined();
    });
  });

  describe('malformed input never throws', () => {
    it.each([undefined, null, 'a string', 42, []])('survives %p', raw => {
      expect(() => parseServerConfig(raw)).not.toThrow();
      expect(parseServerConfig(raw).strudelUrl).toBe(DEFAULT_STRUDEL_URL);
    });

    it('warns when the file is not an object', () => {
      expect(parseServerConfig('nope').warnings.join(' ')).toMatch(/must contain a JSON object/);
    });
  });
});
