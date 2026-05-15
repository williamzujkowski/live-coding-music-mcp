/**
 * diagnostics domain — observability tools (browser status, errors,
 * server metrics).
 *
 * Owns one consolidated tool (`diagnostics(level)`) with status/full/
 * perf/memory/errors levels.
 *
 * The `<15ms` SLA on `level='status'` is preserved — that branch only
 * reads from the controller's cache, not the browser. Other levels can
 * touch the browser (`level='full'`) or just inspect server state
 * (`perf`, `memory`).
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';

const SESSION_ID_PROP = {
  session_id: {
    type: 'string',
    description: 'Optional session ID (#108). Applies to level=status, full, errors. Ignored for perf/memory (server-wide metrics).',
  },
};

export const tools: Tool[] = [
  {
    name: 'diagnostics',
    description:
      'Inspect server and browser state. ' +
      'level=status returns a quick state snapshot (cache read, <15ms SLA). ' +
      'level=full returns detailed browser diagnostics including caches, errors, and performance. ' +
      'level=perf returns server-side timing metrics + top bottlenecks. ' +
      'level=memory returns process memory usage. ' +
      'level=errors returns captured console errors and warnings from Strudel. ' +
      'Default level=full preserves the pre-consolidation behaviour. ' +
      'Example: diagnostics({ level: "status" }) — millisecond-cheap. ' +
      'For screenshots use browser_window; for tool listings use the strudel://docs/tools resource.',
    inputSchema: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['status', 'full', 'perf', 'memory', 'errors'],
          description: 'Which diagnostic surface to read (default: full)',
        },
        ...SESSION_ID_PROP,
      },
    },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

function getPerformanceReport(ctx: ToolContext): string {
  const report = ctx.perfMonitor.getReport();
  const bottlenecks = ctx.perfMonitor.getBottlenecks(5);
  return `${report}\n\nTop 5 Bottlenecks:\n${JSON.stringify(bottlenecks, null, 2)}`;
}

function getMemoryUsage(ctx: ToolContext): string {
  const memory = ctx.perfMonitor.getMemoryUsage();
  return memory ? JSON.stringify(memory, null, 2) : 'Memory usage not available';
}

function getStatus(ctx: ToolContext, sid?: string): unknown {
  return ctx.getController(sid).getStatus();
}

async function getFullDiagnostics(ctx: ToolContext, sid?: string): Promise<unknown> {
  if (!sid && !ctx.isInitialized()) {
    return {
      initialized: false,
      message: 'Browser not initialized. Run init first for full diagnostics.',
    };
  }
  return await ctx.getController(sid).getDiagnostics();
}

function getErrors(ctx: ToolContext, sid?: string): string {
  const controller = ctx.getController(sid);
  const errors = controller.getConsoleErrors();
  const warnings = controller.getConsoleWarnings();

  if (errors.length === 0 && warnings.length === 0) {
    return 'No errors or warnings captured.';
  }

  let result = '';
  if (errors.length > 0) {
    result += `❌ Errors (${errors.length}):\n${errors.map(e => `  • ${e}`).join('\n')}\n`;
  }
  if (warnings.length > 0) {
    result += `⚠️ Warnings (${warnings.length}):\n${warnings.map(w => `  • ${w}`).join('\n')}`;
  }
  return result.trim();
}

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const sid: string | undefined = args?.session_id;
  switch (name) {
    case 'diagnostics': {
      const level = args?.level ?? 'full';
      switch (level) {
        case 'status':  return getStatus(ctx, sid);
        case 'full':    return await getFullDiagnostics(ctx, sid);
        case 'perf':    return getPerformanceReport(ctx);
        case 'memory':  return getMemoryUsage(ctx);
        case 'errors':  return getErrors(ctx, sid);
        default:
          throw new Error(`Invalid level: ${level}. Must be one of: status, full, perf, memory, errors`);
      }
    }

    default:
      throw new Error(`diagnostics module does not handle tool: ${name}`);
  }
}

export const diagnosticsModule: ToolModule = { tools, toolNames, execute };
