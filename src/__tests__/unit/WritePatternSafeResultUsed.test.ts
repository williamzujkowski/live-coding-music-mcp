/**
 * Structural guard: no tool module may discard `writePatternSafe`'s
 * return value (#285).
 *
 * `writePatternSafe` does not always write. With no browser session up
 * it stashes the pattern in server state and returns a notice saying
 * so. Nineteen call sites across five modules used to `await` it and
 * throw the result away, then return their own success message — so
 * `transform`, `effect`, `shape`, `set_tempo`, `generate_part`,
 * `pattern_store action=load` and `ai_assist` all reported the pattern
 * as applied while it sat in `pendingPattern` waiting for an init the
 * caller had no reason to run.
 *
 * TypeScript cannot catch this: `await f()` with the result discarded
 * compiles clean whatever `f` returns, since there is no `nodiscard`.
 * So the check is textual, like ToolDocsDrift and
 * PageEvaluateNameWrapping.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  PATTERN_STASHED_PREFIX,
  wasStashed,
  withStashNotice,
  withStashField,
  STASH_WARNING,
} from '../../server/tools/types';

const TOOLS_DIR = join(__dirname, '../../server/tools');

/** A call whose result is thrown away: `await ...writePatternSafe(` not bound to anything. */
const DISCARDED = /(^|[^=]\s|[{;]\s*)await\s+ctx\.writePatternSafe\s*\(/;

describe('writePatternSafe results are never discarded (#285)', () => {
  const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'));

  it('finds the tool modules', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s binds every writePatternSafe result', (file) => {
    const src = readFileSync(join(TOOLS_DIR, file), 'utf8');
    const offenders = src
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => line.includes('await ctx.writePatternSafe('))
      .filter(({ line }) => DISCARDED.test(line) && !line.startsWith('return '));

    expect(offenders.map((o) => `${file}:${o.n}  ${o.line}`)).toEqual([]);
  });

  it('server.ts builds its stash message from the shared constant', () => {
    const src = readFileSync(join(__dirname, '../../server/server.ts'), 'utf8');
    // A hand-written copy of the string would drift away from the
    // helpers that detect it; the constant is the whole point.
    expect(src).toContain('${PATTERN_STASHED_PREFIX}');
    expect(src).not.toContain("'Pattern generated (initialize Strudel to use it)");
  });
});

describe('stash helpers', () => {
  const stashed = `${PATTERN_STASHED_PREFIX} s("bd*4")...`;

  it('recognises a stash result', () => {
    expect(wasStashed(stashed)).toBe(true);
  });

  it('does not mistake a normal write for a stash', () => {
    expect(wasStashed('Pattern written')).toBe(false);
    expect(wasStashed('written')).toBe(false);
  });

  it('tolerates a non-string result', () => {
    expect(wasStashed(undefined)).toBe(false);
    expect(wasStashed(null)).toBe(false);
    expect(wasStashed({ ok: true })).toBe(false);
  });

  it('appends the caveat to prose only when stashed', () => {
    expect(withStashNotice('Generated techno drums', stashed))
      .toContain('not in the editor yet');
    expect(withStashNotice('Generated techno drums', stashed))
      .toContain('Generated techno drums');
    expect(withStashNotice('Generated techno drums', 'written'))
      .toBe('Generated techno drums');
  });

  it('adds a warning field to structured results only when stashed', () => {
    expect(withStashField({ success: true, level: 3 }, stashed))
      .toEqual({ success: true, level: 3, warning: STASH_WARNING });
    expect(withStashField({ success: true, level: 3 }, 'written'))
      .toEqual({ success: true, level: 3 });
  });

  it('does not mutate the result it is given', () => {
    const original = { success: true as const, level: 3 };
    withStashField(original, stashed);
    expect(original).toEqual({ success: true, level: 3 });
  });

  it('tells the caller what to do, not just what happened', () => {
    expect(STASH_WARNING).toContain('init');
    expect(withStashNotice('x', stashed)).toContain('init');
  });
});

/**
 * End-to-end through the real tool executors: with no browser session,
 * writePatternSafe stashes, and the tool must say so.
 */
describe('tools surface the stash notice (#285)', () => {
  function makeCtx() {
    let current = 's("bd*4")';
    return {
      perfMonitor: { start: jest.fn(), end: jest.fn() },
      store: { load: jest.fn(async () => ({ content: 's("hh*8")', tags: [] })) },
      theory: {
        generateScale: () => ['C', 'D', 'E'],
        generateChordProgression: () => 'Cmaj7 Dm7',
      },
      generator: {
        generateDrumPattern: () => 's("bd*4")',
        generateChords: () => 'note("<Cmaj7>")',
      },
      sessionManager: {}, geminiService: { isAvailable: () => false },
      strudelEngine: {}, midiExportService: {}, midiImportService: {},
      audioExportService: {},
      getAudioCaptureService: async () => ({}),
      dropAudioCaptureService: jest.fn(),
      getHistory: () => ({ undoStack: [], redoStack: [], historyStack: [], maxHistory: 100 }),
      dropHistory: jest.fn(),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      isInitialized: () => false,
      ensureInitialized: async () => {},
      getController: () => ({ play: jest.fn(), writePattern: jest.fn() }),
      getCurrentPatternSafe: async () => current,
      // Exactly what server.ts does when no browser is up.
      writePatternSafe: async (p: string) => {
        current = p;
        return `${PATTERN_STASHED_PREFIX} ${p.substring(0, 50)}...`;
      },
    } as any;
  }

  it('generate_part role=drums says the pattern is not in the editor', async () => {
    const { execute } = await import('../../server/tools/generate');
    const r = await execute('generate_part', { role: 'drums', style: 'techno' }, makeCtx());
    expect(String(r)).toContain('not in the editor yet');
    expect(String(r)).toContain('init');
  });

  it('music_theory query=chord_progression says the same', async () => {
    const { execute } = await import('../../server/tools/generate');
    const r = await execute(
      'music_theory', { query: 'chord_progression', key: 'C', style: 'jazz' }, makeCtx());
    expect(String(r)).toContain('not in the editor yet');
  });

  // transform / editor / ai refuse outright when the default session
  // isn't up (`if (!sid && !ctx.isInitialized())`), so the stash path is
  // unreachable there and there was never anything to mis-report. Their
  // threading is defensive — kept so the guard above holds uniformly and
  // so the behaviour is already right if a gate is ever relaxed.
  it.each([
    ['transform', { op: 'reverse' }],
    ['set_tempo', { bpm: 140 }],
    ['shape', { dimension: 'energy', level: 5 }],
  ])('%s refuses rather than stashing', async (name, args) => {
    const { execute } = await import('../../server/tools/transform');
    const r = await execute(name as string, args, makeCtx());
    expect(String(r)).toContain('not initialized');
  });

  it('shape carries a warning field when a write does stash', async () => {
    const { execute } = await import('../../server/tools/transform');
    const ctx = makeCtx();
    // Past the module gate, but with a write that stashes anyway.
    ctx.isInitialized = () => true;
    const r: any = await execute('shape', { dimension: 'energy', level: 5 }, ctx);
    expect(r.success).toBe(true);
    expect(r.warning).toBe(STASH_WARNING);
  });

  it('pattern_store action=load says the same', async () => {
    const { execute } = await import('../../server/tools/storage');
    const r = await execute('pattern_store', { action: 'load', name: 'x' }, makeCtx());
    expect(String(r)).toContain('not in the editor yet');
  });

  it('says nothing extra once a browser session is up', async () => {
    const { execute } = await import('../../server/tools/generate');
    const ctx = makeCtx();
    ctx.isInitialized = () => true;
    ctx.writePatternSafe = async () => 'written';
    const r = await execute('generate_part', { role: 'drums', style: 'techno' }, ctx);
    expect(String(r)).toBe('Generated techno drums');
  });
});
