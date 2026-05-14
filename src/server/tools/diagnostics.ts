/**
 * diagnostics domain — performance, memory, status, errors, screenshots.
 *
 * Owns (6 tools today): performance_report, memory_usage, screenshot,
 * status, diagnostics, show_errors.
 *
 * Post-consolidation target (per #110 audit): one `diagnostics` tool with
 * a `level` enum. For now we keep the individual verbs and only move them
 * out of server.ts; consolidation happens later under #120.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';

const SESSION_ID_PROP = {
  session_id: {
    type: 'string',
    description: 'Optional session ID (#108). Omit to use default session.',
  },
};

export const tools: Tool[] = [
  {
    // Server-wide metric; session_id not applicable.
    name: 'performance_report',
    description: 'Get performance metrics and bottlenecks',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    // Server-wide; session_id not applicable.
    name: 'memory_usage',
    description: 'Get current memory usage statistics',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'screenshot',
    description: 'Take a screenshot of the current Strudel editor state',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Optional filename for screenshot' },
        ...SESSION_ID_PROP,
      },
    },
  },
  {
    name: 'status',
    description: 'Get current browser and playback status (quick state check)',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
  {
    name: 'diagnostics',
    description: 'Get detailed browser diagnostics including cache, errors, and performance',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
  {
    name: 'show_errors',
    description: 'Display captured console errors and warnings from Strudel',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const sid: string | undefined = args?.session_id;
  switch (name) {
    case 'performance_report': {
      const report = ctx.perfMonitor.getReport();
      const bottlenecks = ctx.perfMonitor.getBottlenecks(5);
      return `${report}\n\nTop 5 Bottlenecks:\n${JSON.stringify(bottlenecks, null, 2)}`;
    }

    case 'memory_usage': {
      const memory = ctx.perfMonitor.getMemoryUsage();
      return memory ? JSON.stringify(memory, null, 2) : 'Memory usage not available';
    }

    case 'screenshot': {
      if (!sid && !ctx.isInitialized()) {
        return 'Browser not initialized. Run init first.';
      }
      return await ctx.getController(sid).takeScreenshot(args?.filename);
    }

    case 'status':
      return ctx.getController(sid).getStatus();

    case 'diagnostics': {
      if (!sid && !ctx.isInitialized()) {
        return {
          initialized: false,
          message: 'Browser not initialized. Run init first for full diagnostics.',
        };
      }
      return await ctx.getController(sid).getDiagnostics();
    }

    case 'show_errors': {
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

    default:
      throw new Error(`diagnostics module does not handle tool: ${name}`);
  }
}

export const diagnosticsModule: ToolModule = { tools, toolNames, execute };
