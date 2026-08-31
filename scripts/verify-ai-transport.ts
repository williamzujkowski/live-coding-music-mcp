#!/usr/bin/env npx tsx
/**
 * End-to-end check that AI features work through a locally authenticated
 * CLI, with no API key (#252).
 *
 * Cannot run in CI: it needs a logged-in CLI. The unit tests cover
 * argument construction and failure handling without spawning anything.
 *
 * Usage:
 *   npm run test:ai-transport
 */

/* eslint-disable no-console */

import { GeminiService } from '../src/services/GeminiService.js';
import { cliTransports } from '../src/services/ai/CliTransport.js';

async function main(): Promise<void> {
  console.log(`GEMINI_API_KEY set: ${String(!!process.env.GEMINI_API_KEY)}`);

  console.log('\nTransports:');
  let anyReachable = false;
  for (const t of cliTransports(90_000)) {
    if (!(await t.isAvailable())) {
      console.log(`  --    ${t.id} not installed`);
      continue;
    }
    const started = Date.now();
    try {
      const reply = await t.send('Reply with exactly the single word: PONG');
      const ok = reply.toUpperCase().includes('PONG');
      if (ok) anyReachable = true;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${t.id} ${String(Date.now() - started)}ms -> ${JSON.stringify(reply.slice(0, 40))}`);
    } catch (error: unknown) {
      console.log(`  FAIL  ${t.id}: ${(error as Error).message.slice(0, 70)}`);
    }
  }

  if (!anyReachable) {
    console.error('\nNo CLI transport could reach a model. Log in to one of: claude, agy, codex.');
    process.exit(1);
  }

  console.log('\nService through the resolved transport:');
  const service = new GeminiService();
  console.log(`  isAvailable(): ${String(service.isAvailable())}`);
  console.log(`  transport:     ${String(await service.getTransportId())}`);

  const feedback = await service.getCreativeFeedback('stack(s("bd*4"), s("~ cp")).cpm(30)');
  const ok =
    typeof feedback.estimatedStyle === 'string' &&
    Array.isArray(feedback.suggestions) &&
    feedback.suggestions.length > 0;

  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  getCreativeFeedback -> complexity=${feedback.complexity}, ${String(feedback.suggestions.length)} suggestions`);

  if (!ok) {
    console.error('\nThe transport answered but the response did not parse into CreativeFeedback.');
    process.exit(1);
  }
  console.log('\nAI transport works without an API key.');
}

main().catch((error: unknown) => {
  console.error('verify-ai-transport failed:', error);
  process.exit(1);
});
