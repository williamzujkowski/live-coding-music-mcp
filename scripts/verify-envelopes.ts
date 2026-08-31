#!/usr/bin/env npx tsx
/**
 * Route check: does an error keep its category all the way to the wire?
 *
 * Three times in one day a fix was correct and the plumbing swallowed
 * it. A typed error was destroyed at the tool/dispatcher seam because
 * the tool kept only `.message`; another was destroyed crossing IPC
 * because a class cannot travel as JSON; the isolation guard passed a
 * sandbox check that ran without the heap cap it was testing. Every
 * time, the unit tests passed — they construct the error and call the
 * categoriser directly, which is not the path production takes.
 *
 * This drives the built server over real stdio JSON-RPC, exactly as an
 * MCP client would, and asserts the envelope the client receives.
 *
 * Usage:
 *   npm run test:envelopes
 */

/* eslint-disable no-console */

import { spawn } from 'node:child_process';

interface Expectation {
  name: string;
  tool: string;
  args: Record<string, unknown>;
  category: string;
  retryable: boolean;
  /** A fragment the message must contain, so a right answer for the wrong reason fails. */
  says: string;
}

const CASES: Expectation[] = [
  {
    name: 'steps over the cap',
    tool: 'generate_rhythm',
    args: { type: 'euclidean', steps: 9999, hits: 3 },
    category: 'validation',
    retryable: false,
    says: 'Steps cannot exceed 256',
  },
  {
    name: 'more hits than steps',
    tool: 'generate_rhythm',
    args: { type: 'euclidean', steps: 8, hits: 99 },
    category: 'validation',
    retryable: false,
    says: 'cannot exceed steps',
  },
  {
    name: 'a tool that needs a browser',
    tool: 'playback',
    args: { action: 'play' },
    category: 'business',
    retryable: false,
    says: 'not initialized',
  },
  {
    name: 'a pattern too dense to materialize',
    tool: 'query_pattern_events',
    args: { pattern: 's("[bd*99999]*99999")', start: 0, end: 1 },
    category: 'validation',
    retryable: false,
    says: 'cap',
  },
];

/** Sends one tools/call to a fresh server and returns the envelope it answers with. */
async function callTool(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['dist/index.js'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out calling ${tool}`));
    }, 30_000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
      for (const line of out.split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        try {
          const parsed = JSON.parse(line) as {
            id?: number;
            result?: { content?: { text?: string }[] };
          };
          if (parsed.id !== 1) continue;
          const text = parsed.result?.content?.[0]?.text ?? '';
          clearTimeout(timer);
          child.kill('SIGKILL');
          resolve(JSON.parse(text) as Record<string, unknown>);
          return;
        } catch {
          // Partial line; wait for more.
        }
      }
    });
    child.on('error', reject);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: tool, arguments: args }, id: 1 })}\n`
    );
  });
}

async function main(): Promise<void> {
  console.log('Envelope route checks (built server, real stdio JSON-RPC):');
  let failures = 0;

  for (const expected of CASES) {
    let envelope: Record<string, unknown>;
    try {
      envelope = await callTool(expected.tool, expected.args);
    } catch (error: unknown) {
      failures++;
      console.error(`  FAIL  ${expected.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const problems: string[] = [];
    if (envelope.ok !== false) problems.push(`ok=${String(envelope.ok)}, expected false`);
    if (envelope.errorCategory !== expected.category) {
      problems.push(`category=${String(envelope.errorCategory)}, expected ${expected.category}`);
    }
    if (envelope.isRetryable !== expected.retryable) {
      problems.push(`isRetryable=${String(envelope.isRetryable)}, expected ${String(expected.retryable)}`);
    }
    if (typeof envelope.message !== 'string' || !envelope.message.includes(expected.says)) {
      problems.push(`message does not mention "${expected.says}": ${String(envelope.message).slice(0, 80)}`);
    }

    if (problems.length > 0) {
      failures++;
      console.error(`  FAIL  ${expected.name} — ${problems.join('; ')}`);
    } else {
      console.log(`  ok    ${expected.name} -> ${expected.category}, retryable=${String(expected.retryable)}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${String(failures)} route check(s) failed.`);
    process.exit(1);
  }
  console.log('\nEvery error kept its category to the wire.');
}

main().catch((error: unknown) => {
  console.error('verify-envelopes crashed:', error);
  process.exit(1);
});
