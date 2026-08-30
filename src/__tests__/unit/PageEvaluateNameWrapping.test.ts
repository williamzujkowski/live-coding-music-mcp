/**
 * Guard against esbuild's `__name` wrapper leaking into page context (#248).
 *
 * `tsx` transpiles with esbuild's `keepNames`, which rewrites a named
 * inner function into `__name(fn, "fn")` so `.name` survives
 * minification. Playwright serializes the function passed to
 * `page.evaluate` and runs the source in the browser, where `__name` does
 * not exist — so the whole evaluate throws:
 *
 *   page.evaluate: ReferenceError: __name is not defined
 *
 * `tsc` emits the function untouched, so this breaks **only** when
 * running from source: `npm run dev` (`tsx watch src/index.ts`) and the
 * `test:sandbox` / `test:export-audio` scripts. `npm start` runs `dist/`
 * and is fine, and CI builds first, so neither would ever catch it.
 *
 * The unit tests cannot catch it either: they mock `page.evaluate`, so
 * the function is never serialized and never leaves Node.
 *
 * That leaves this: transpile each source file the way tsx does, find the
 * `.evaluate(...)` arguments, and fail if a `__name` call is inside one.
 *
 * If this test fails, rewrite the offending helper. Only two forms
 * survive esbuild:
 *   - object METHOD shorthand:  `{ helper(x) { ... } }`
 *   - anonymous inline arrows:  `arr.map(x => ...)`
 * A `const fn = () => {}`, a `function fn() {}` declaration, and a
 * `{ prop: () => {} }` property arrow are all wrapped.
 */

import { transformSync } from 'esbuild';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');

/** Every .ts file under src/, excluding tests and mocks. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === '__mocks__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) found.push(full);
  }
  return found;
}

/**
 * Extracts a balanced `(...)` or `{...}` region starting at `from`.
 * Returns '' if unbalanced.
 */
function balancedFrom(code: string, from: number, open: string, close: string): string {
  const start = code.indexOf(open, from);
  if (start === -1) return '';
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === open) depth++;
    else if (code[i] === close) {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  return '';
}

/**
 * Resolves a function passed to evaluate *by reference*.
 *
 * This is the case that matters most and the one a naive check misses:
 * `page.evaluate(Service.browserCapture, args)` puts the function body
 * nowhere near the call site, so scanning the argument text finds only
 * the identifier. That is exactly the shape the real bug took.
 */
function resolveReferencedBody(code: string, argText: string): string {
  const symbol = argText.trim().split('.').pop() ?? '';
  if (!/^[A-Za-z_$][\w$]*$/.test(symbol)) return '';

  // Matches `foo = ...`, `const foo = ...`, and class field `foo = ...`.
  const assignment = new RegExp(`\\b${symbol}\\s*=`).exec(code);
  if (assignment === null) return '';

  const body = balancedFrom(code, assignment.index, '{', '}');
  return body;
}

/**
 * Returns the source of each `.evaluate(...)` argument list, by walking
 * balanced parentheses from the call. A regex cannot do this: the
 * arguments are multi-line function bodies containing their own parens.
 */
function evaluateCallArguments(code: string): string[] {
  const calls: string[] = [];
  const needle = '.evaluate(';
  let cursor = 0;

  for (;;) {
    const start = code.indexOf(needle, cursor);
    if (start === -1) break;

    let depth = 0;
    let end = -1;
    for (let i = start + needle.length - 1; i < code.length; i++) {
      const ch = code[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break;

    calls.push(code.slice(start, end + 1));
    cursor = end + 1;
  }

  return calls;
}

describe('page.evaluate functions survive esbuild (#248)', () => {
  const files = sourceFiles(SRC);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('no evaluate() argument contains an esbuild __name wrapper', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      if (!source.includes('.evaluate(')) continue;

      // Same transform tsx applies. keepNames is what injects __name.
      const { code } = transformSync(source, {
        loader: 'ts',
        keepNames: true,
        target: 'es2022',
      });

      for (const call of evaluateCallArguments(code)) {
        // The argument list itself, for inline functions...
        let suspect = call;

        // ...and, when the function is passed by reference, its body
        // wherever it is defined in the file.
        const firstArg = call.slice(call.indexOf('(') + 1);
        if (!firstArg.trimStart().startsWith('(') && !firstArg.trimStart().startsWith('async')
            && !firstArg.trimStart().startsWith('function')) {
          const comma = firstArg.indexOf(',');
          const ref = comma === -1 ? firstArg.slice(0, -1) : firstArg.slice(0, comma);
          suspect += resolveReferencedBody(code, ref);
        }

        if (suspect.includes('__name(')) {
          const named = /__name\([^,]*,\s*"([^"]+)"\)/.exec(suspect);
          offenders.push(
            `${file.replace(SRC, 'src')}: helper '${named?.[1] ?? '?'}' reachable from .evaluate() ` +
            'will throw "ReferenceError: __name is not defined" in the browser'
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * The guard is worthless if it cannot see the thing it guards against,
   * so prove it fires on each wrapped form and stays quiet on the safe
   * ones. Without this, a change to esbuild's output or to the extraction
   * logic would silently disarm the check above.
   */
  describe('the guard actually detects wrapping', () => {
    const check = (body: string): boolean => {
      const { code } = transformSync(
        `declare const page: any;\nasync function f() { await page.evaluate(${body}); }`,
        { loader: 'ts', keepNames: true, target: 'es2022' },
      );
      return evaluateCallArguments(code).some(c => c.includes('__name('));
    };

    it.each([
      ['const arrow', '() => { const inner = (x: number) => x * 2; return inner(1); }'],
      ['function declaration', '() => { function inner(x: number) { return x * 2; } return inner(1); }'],
      ['property arrow', '() => { const o = { helper: (x: number) => x * 2 }; return o.helper(1); }'],
    ])('detects a wrapped %s', (_label, body) => {
      expect(check(body)).toBe(true);
    });

    it.each([
      ['method shorthand', '() => { const o = { helper(x: number) { return x * 2; } }; return o.helper(1); }'],
      ['anonymous inline arrow', '() => [1, 2].map(x => x * 2)'],
      ['no inner function', '() => (window as any).strudelMirror?.stop?.()'],
    ])('stays quiet for a safe %s', (_label, body) => {
      expect(check(body)).toBe(false);
    });
  });
});
