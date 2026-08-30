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
  'ChainExpression', 'ParenthesizedExpression', 'EmptyStatement',
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
        declared.add(node.name);
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
