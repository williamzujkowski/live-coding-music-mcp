/**
 * PatternSandbox - containment for locally-executed Strudel pattern code
 *
 * `StrudelEngine` has to *run* pattern code to validate it or query its
 * events: a pattern is JavaScript that builds a Pattern object, and there
 * is no way to know what it produces without evaluating it.
 *
 * It used to do that with `new Function(...)` directly in the server
 * process (#229). That is arbitrary code execution: the Strudel transpiler
 * is an acorn-based source-to-source rewriter, not a sandbox — it turns
 * double-quoted strings into `mini()` calls and passes every other
 * statement through untouched. `validate_pattern_local` also runs without
 * `init`, so the whole path was reachable with no browser and no session.
 *
 * Two layers guard it now:
 *
 *   1. `assertPatternIsSafe()` — an acorn AST allowlist over the *source*.
 *      Free identifiers must be Strudel functions, a small set of safe
 *      builtins, or something the code declared itself. Member access to
 *      `constructor` / `__proto__` / `prototype` is rejected, as is
 *      dynamic member access with a computed key.
 *
 *   2. `runPatternCode()` — `node:vm` with code generation disabled and a
 *      wall-clock timeout.
 *
 * Layer 2 is deliberately *not* the primary control. `node:vm` is not a
 * security boundary: the sandbox receives real host functions, and
 * `someHostFn.constructor.constructor('return process')()` compiles in the
 * main realm, reaching `process` straight through the context wall. That
 * escape is verified to work, which is exactly why layer 1 bans
 * `.constructor` at the syntax level and never lets the expression form.
 *
 * @module services/PatternSandbox
 * @nist si-10 "Information input validation"
 * @nist sc-39 "Process isolation"
 */

import { parse } from 'acorn';
import { createContext, runInContext } from 'node:vm';

/** Wall-clock budget for a single pattern evaluation. */
export const EXECUTION_TIMEOUT_MS = 1000;

/**
 * Property names that expose a route out of the sandbox.
 *
 * `constructor` is the important one: from any host function it reaches
 * the real `Function` constructor, which compiles in the main realm.
 */
const BANNED_PROPERTIES = new Set([
  'constructor',
  '__proto__',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

/**
 * Names a binding may not introduce, however it is declared.
 *
 * `collectDeclaredNames` is scope-blind on purpose — it builds one
 * whole-file set, so a name declared anywhere makes bare references to
 * it legal everywhere. That is fine for `const kick = ...`, and it was
 * a hole for anything the sandbox deliberately withholds:
 *
 *     function bypass(Reflect) {}   // never called
 *     Reflect.get(...)              // now a legal identifier
 *
 * Measured: with that dead parameter present, bare `Reflect`, `Object`,
 * `globalThis`, `Function` and `eval` all became referenceable, and each
 * resolves at runtime to the vm context's real intrinsic — not to the
 * unused parameter. `SAFE_GLOBALS` omits `Object` and `Reflect`
 * deliberately; a parameter name was undoing that decision.
 *
 * The same rule `BANNED_PROPERTIES` already gets: a binding named after
 * something withheld does not make it available. Proper lexical scoping
 * would be the general fix; this closes the measured hole without
 * rewriting the checker into a scope analyser.
 *
 * No demonstrated escape came out of it — `Function` and `eval` inside
 * the context are dead under `codeGeneration: { strings: false }`, and
 * `process` and `require` are absent — but this is the layer whose job
 * is to stop the attempt, and failing to build a chain is not proof
 * that none exists.
 */
const BANNED_BINDINGS = new Set([
  'Object', 'Reflect', 'Proxy', 'Function', 'eval',
  'globalThis', 'global', 'process', 'require', 'module', 'exports',
  'import', 'WeakRef', 'FinalizationRegistry', 'Symbol', 'Promise',
]);

/**
 * Globals a pattern may legitimately reference beyond the Strudel context.
 *
 * Deliberately excludes `Object` and `Reflect` — both walk prototype
 * chains, and while BANNED_PROPERTIES blocks the obvious follow-up, there
 * is no reason a pattern needs them.
 */
const SAFE_GLOBALS = new Set([
  'Math', 'Number', 'String', 'Boolean', 'Array', 'JSON', 'Date',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'NaN', 'Infinity', 'undefined',
]);

/**
 * Largest numeric literal a pattern may contain.
 *
 * A fast-fail for accidents and naive input, NOT a security control.
 * `Array(50000000).fill(7)` reached 1908 MB in 5791 ms before the vm's
 * 1000 ms timeout fired — V8 cannot interrupt inside an allocating
 * builtin, so a wall-clock budget is not a memory budget (#307).
 *
 * A determined payload evades this trivially by computing the number
 * (`Array(1e4 * 5e3)`), and this deliberately does not try to constant-
 * fold arithmetic — chasing that is an arms race an AST walk loses. The
 * real containment is process isolation with a hard heap cap, settled
 * by measurement on #307: worker_threads with `resourceLimits` does NOT
 * contain the OOM (the parent dumped core), a forked child with
 * `--max-old-space-size` does.
 *
 * What this buys, honestly: the common accidental case fails in
 * microseconds with a message naming the problem, instead of allocating
 * hundreds of megabytes first.
 *
 * The bound is far above anything musical — a pattern asking for a
 * million of anything is not describing music.
 */
const MAX_NUMERIC_LITERAL = 1_000_000;

/** AST node types a pattern is allowed to contain. */
const ALLOWED_NODE_TYPES = new Set([
  'Program', 'ExpressionStatement', 'CallExpression', 'MemberExpression',
  'Identifier', 'Literal', 'TemplateLiteral', 'TemplateElement',
  'TaggedTemplateExpression', 'ArrayExpression', 'ObjectExpression',
  'Property', 'ArrowFunctionExpression', 'FunctionExpression',
  'FunctionDeclaration', 'BlockStatement', 'ReturnStatement',
  'VariableDeclaration', 'VariableDeclarator', 'BinaryExpression',
  'UnaryExpression', 'LogicalExpression', 'ConditionalExpression',
  'SpreadElement', 'RestElement', 'AssignmentExpression', 'UpdateExpression',
  'ArrayPattern', 'ObjectPattern', 'AssignmentPattern', 'SequenceExpression',
  // No 'ParenthesizedExpression': acorn only produces that node with
  // `preserveParens: true`, which this parser does not pass, so the
  // entry never matched anything. Verified — `(note("c"))` parses to
  // Program/ExpressionStatement/CallExpression/Identifier/Literal (#491).
  'ChainExpression', 'EmptyStatement',
  'IfStatement', 'ForStatement', 'ForOfStatement', 'WhileStatement',
  'BreakStatement', 'ContinueStatement',
]);

/** Raised when a pattern is rejected before execution. */
export class PatternSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatternSafetyError';
  }
}

/** Walks every child node of an AST node. */
function* childNodes(node: any): Generator<any> {
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === 'string') yield item;
      }
    } else if (value && typeof value.type === 'string') {
      yield value;
    }
  }
}

/** Collects every name the code binds, so locals aren't mistaken for globals. */
function collectDeclaredNames(ast: any): Set<string> {
  const declared = new Set<string>();

  const addPattern = (node: any): void => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'Identifier':
        // A binding named after a banned property — or after a global
        // the sandbox withholds — would otherwise make later bare
        // references to it legal anywhere in the file.
        if (!BANNED_PROPERTIES.has(node.name) && !BANNED_BINDINGS.has(node.name)) {
          declared.add(node.name);
        }
        break;
      case 'ObjectPattern':
        for (const prop of node.properties ?? []) {
          addPattern(prop.type === 'Property' ? prop.value : prop.argument);
        }
        break;
      case 'ArrayPattern':
        for (const el of node.elements ?? []) addPattern(el);
        break;
      case 'AssignmentPattern':
        addPattern(node.left);
        break;
      case 'RestElement':
        addPattern(node.argument);
        break;
      default:
        break;
    }
  };

  const walk = (node: any): void => {
    if (node.type === 'VariableDeclarator') addPattern(node.id);
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      if (node.id) addPattern(node.id);
      for (const param of node.params ?? []) addPattern(param);
    }
    for (const child of childNodes(node)) walk(child);
  };

  walk(ast);
  return declared;
}

/**
 * Rejects pattern source that could escape the sandbox.
 *
 * @param code - Strudel pattern source, before transpilation
 * @param allowedGlobals - Names provided by the Strudel execution context
 * @throws {PatternSafetyError} When the pattern is not safe to execute
 * @nist si-10 "Information input validation"
 */
export function assertPatternIsSafe(code: string, allowedGlobals: Iterable<string>): void {
  let ast: any;
  try {
    ast = parse(code, { ecmaVersion: 2022, sourceType: 'script' });
  } catch (error: any) {
    // Let the transpiler produce the friendly syntax-error message; this
    // path only needs to refuse to execute unparseable input.
    throw new PatternSafetyError(`Pattern could not be parsed: ${error.message}`);
  }

  const declared = collectDeclaredNames(ast);
  const allowed = new Set([...allowedGlobals, ...SAFE_GLOBALS, ...declared]);

  const walk = (node: any, parent: any): void => {
    if (!ALLOWED_NODE_TYPES.has(node.type)) {
      throw new PatternSafetyError(
        `Pattern contains disallowed syntax (${node.type}). ` +
        'Patterns may only build and combine Strudel values.'
      );
    }

    // Destructuring reads a property with no MemberExpression node at
    // all — `const { constructor: C } = note` binds the same function
    // that `note.constructor` would, and the check below never sees it.
    // collectDeclaredNames then added `C` to the allowed set, so the
    // identifier check passed too. Two holes lining up into a sandbox
    // escape (#SANDBOX).
    // Cheap upper bound on allocation-shaped input. See
    // MAX_NUMERIC_LITERAL: a fast-fail, not a control.
    // `bigint` counts too.
    //
    // This tested `typeof node.value === 'number'` only, so a bigint
    // literal walked straight past it: `Array(Number(50000000n)).fill(7)`
    // was accepted by the AST check. Measured, the isolated child's heap
    // cap caught it and returned a clean error, so it was contained
    // rather than an escape — but a fast-fail that any `n` suffix
    // sidesteps is not the fast-fail it claims to be (#491).
    if (node.type === 'Literal'
        && (typeof node.value === 'number' || typeof node.value === 'bigint')) {
      const magnitude = typeof node.value === 'bigint'
        ? (node.value < 0n ? -node.value : node.value)
        : Math.abs(node.value);
      const overLimit = typeof magnitude === 'bigint'
        ? magnitude > BigInt(MAX_NUMERIC_LITERAL)
        : Number.isFinite(magnitude) && magnitude > MAX_NUMERIC_LITERAL;
      if (overLimit) {
        throw new PatternSafetyError(
          `Pattern contains the number ${String(node.value)}, above the ` +
          `${String(MAX_NUMERIC_LITERAL)} limit. Numbers that large usually mean ` +
          'an allocation mistake rather than a musical intent.'
        );
      }
    }

    if (node.type === 'ObjectPattern') {
      for (const prop of node.properties ?? []) {
        if (prop.type !== 'Property') continue;
        const key = prop.key;
        const name = prop.computed
          ? (key?.type === 'Literal' ? String(key.value) : null)
          : (key?.name ?? (key?.type === 'Literal' ? String(key.value) : null));
        if (name === null) {
          throw new PatternSafetyError(
            'Pattern destructures a computed property name, which is not allowed. ' +
            'Use a literal property name.'
          );
        }
        if (BANNED_PROPERTIES.has(name)) {
          throw new PatternSafetyError(
            `Pattern destructures the disallowed property '${name}'.`
          );
        }
      }
    }

    // An object literal with a computed key was never inspected, so
    // `{ ["constructor"]: … }` passed. Nothing here needs computed keys.
    if (node.type === 'Property' && node.computed && parent?.type !== 'ObjectPattern') {
      const key = node.key;
      const name = key?.type === 'Literal' ? String(key.value) : null;
      if (name === null || BANNED_PROPERTIES.has(name)) {
        throw new PatternSafetyError(
          'Pattern uses a computed object key, which is not allowed. ' +
          'Use a literal property name.'
        );
      }
    }

    if (node.type === 'MemberExpression') {
      if (node.computed) {
        // `x["constructor"]` and `x[name]` both die here; a literal index
        // like `[1,2,3][0]` is still fine.
        if (node.property.type === 'Literal') {
          if (BANNED_PROPERTIES.has(String(node.property.value))) {
            throw new PatternSafetyError(
              `Pattern accesses the disallowed property '${String(node.property.value)}'.`
            );
          }
        } else {
          throw new PatternSafetyError(
            'Pattern uses computed property access, which is not allowed. ' +
            'Use a literal property name.'
          );
        }
      } else if (BANNED_PROPERTIES.has(node.property.name)) {
        throw new PatternSafetyError(
          `Pattern accesses the disallowed property '${node.property.name}'.`
        );
      }
    }

    // Identifiers in a *reference* position must resolve to something known.
    // Property names, object keys, and binding sites are not references.
    if (node.type === 'Identifier' && parent) {
      const isPropertyName =
        parent.type === 'MemberExpression' && parent.property === node && !parent.computed;
      const isObjectKey =
        parent.type === 'Property' && parent.key === node && !parent.computed;
      if (!isPropertyName && !isObjectKey && !allowed.has(node.name)) {
        throw new PatternSafetyError(
          `Pattern references unknown identifier '${node.name}'. ` +
          'Only Strudel functions and locally declared names are available.'
        );
      }
    }

    for (const child of childNodes(node)) walk(child, node);
  };

  walk(ast, null);
}

/**
 * Runs transpiled pattern code against the Strudel context.
 *
 * Defense in depth behind `assertPatternIsSafe`. Code generation is
 * disabled so `eval` and `Function` throw inside the context, and the
 * timeout bounds a runaway pattern.
 *
 * @param transpiledCode - Output of the Strudel transpiler
 * @param context - Strudel functions to expose
 * @param timeoutMs - Wall-clock budget
 * @returns Whatever the pattern code evaluates to
 * @nist sc-39 "Process isolation"
 */
export function runPatternCode(
  transpiledCode: string,
  context: Record<string, unknown>,
  timeoutMs: number = EXECUTION_TIMEOUT_MS,
): unknown {
  const sandbox: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(context)) sandbox[key] = value;

  const vmContext = createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });

  return runInContext(`(function(){${transpiledCode}\n})()`, vmContext, {
    timeout: timeoutMs,
    // No importModuleDynamically callback: dynamic import throws
    // ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING rather than resolving.
  });
}
