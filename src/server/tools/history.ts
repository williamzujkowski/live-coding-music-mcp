/**
 * history domain — undo/redo stacks and the pattern history browser.
 *
 * Owns (5 tools): undo, redo, list_history, restore_history,
 * compare_patterns. Post-consolidation target per the #110 audit:
 * single `history` tool with an `action` enum. For now we keep the
 * individual verbs.
 *
 * The history module mutates the three state arrays (undoStack,
 * redoStack, historyStack) passed through ctx.history. The outer
 * server pushes onto these arrays on write/append/insert/replace/clear,
 * so all mutations share the same underlying storage.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolModule } from './types.js';

const SESSION_ID_PROP = {
  session_id: {
    type: 'string',
    description: 'Optional session ID (#108). Omit to use default session. Note: undo/redo/history stacks are currently server-wide; only the read/write target changes.',
  },
};

export const tools: Tool[] = [
  {
    name: 'undo',
    description: 'Undo last action',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
  {
    name: 'redo',
    description: 'Redo action',
    inputSchema: { type: 'object', properties: { ...SESSION_ID_PROP } },
  },
  {
    name: 'list_history',
    description: 'List recent pattern history with timestamps and previews',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum entries to return (default: 10)' },
      },
    },
  },
  {
    name: 'restore_history',
    description: 'Restore a previous pattern from history by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'History entry ID to restore' },
        ...SESSION_ID_PROP,
      },
      required: ['id'],
    },
  },
  {
    name: 'compare_patterns',
    description: 'Compare two patterns from history showing differences',
    inputSchema: {
      type: 'object',
      properties: {
        id1: { type: 'number', description: 'First pattern ID' },
        id2: { type: 'number', description: 'Second pattern ID (default: current pattern)' },
        ...SESSION_ID_PROP,
      },
      required: ['id1'],
    },
  },
];

export const toolNames = new Set(tools.map(t => t.name));

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function generateDiff(a: string, b: string): string[] {
  const l1 = a.split('\n');
  const l2 = b.split('\n');
  const out: string[] = [];
  const max = Math.max(l1.length, l2.length);
  for (let i = 0; i < max; i++) {
    const x = l1[i] || '';
    const y = l2[i] || '';
    if (x === y) {
      out.push(`  ${x}`);
    } else {
      if (x) out.push(`- ${x}`);
      if (y) out.push(`+ ${y}`);
    }
  }
  return out;
}

function summarizeDiff(a: string, b: string): {
  linesAdded: number;
  linesRemoved: number;
  linesChanged: number;
  charsDiff: number;
} {
  const l1 = a.split('\n');
  const l2 = b.split('\n');
  let added = 0, removed = 0, changed = 0;
  const max = Math.max(l1.length, l2.length);
  for (let i = 0; i < max; i++) {
    const x = l1[i];
    const y = l2[i];
    if (x === undefined && y !== undefined) added++;
    else if (x !== undefined && y === undefined) removed++;
    else if (x !== y) changed++;
  }
  return { linesAdded: added, linesRemoved: removed, linesChanged: changed, charsDiff: b.length - a.length };
}

export async function execute(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const { undoStack, redoStack, historyStack, maxHistory } = ctx.history;
  const sid: string | undefined = args?.session_id;

  switch (name) {
    case 'undo': {
      if (!sid && !ctx.isInitialized()) return 'Browser not initialized. Run init first.';
      if (undoStack.length === 0) return 'Nothing to undo';
      const controller = ctx.getController(sid);

      const current = await controller.getCurrentPattern();
      redoStack.push(current);
      if (redoStack.length > maxHistory) redoStack.shift();

      const previous = undoStack.pop()!;
      await controller.writePattern(previous);
      return 'Undone';
    }

    case 'redo': {
      if (!sid && !ctx.isInitialized()) return 'Browser not initialized. Run init first.';
      if (redoStack.length === 0) return 'Nothing to redo';
      const controller = ctx.getController(sid);

      const current = await controller.getCurrentPattern();
      undoStack.push(current);
      if (undoStack.length > maxHistory) undoStack.shift();

      const next = redoStack.pop()!;
      await controller.writePattern(next);
      return 'Redone';
    }

    case 'list_history': {
      if (historyStack.length === 0) {
        return 'No pattern history yet. Make some edits to build history.';
      }
      const limit = args?.limit || 10;
      const recent = historyStack.slice(-limit).reverse();
      return {
        count: historyStack.length,
        showing: recent.length,
        entries: recent.map(e => ({
          id: e.id,
          preview: e.pattern.substring(0, 60) + (e.pattern.length > 60 ? '...' : ''),
          chars: e.pattern.length,
          action: e.action,
          timestamp: formatTimeAgo(e.timestamp),
        })),
      };
    }

    case 'restore_history': {
      if (!sid && !ctx.isInitialized()) return 'Browser not initialized. Run init first.';
      const controller = ctx.getController(sid);

      const entry = historyStack.find(e => e.id === args.id);
      if (!entry) {
        return `History entry #${args.id} not found. Use list_history to see available entries.`;
      }

      const current = await controller.getCurrentPattern();
      undoStack.push(current);
      if (undoStack.length > maxHistory) undoStack.shift();

      await controller.writePattern(entry.pattern);
      return `Restored pattern from history #${args.id} (${formatTimeAgo(entry.timestamp)})`;
    }

    case 'compare_patterns': {
      const first = historyStack.find(e => e.id === args.id1);
      if (!first) return `History entry #${args.id1} not found.`;

      let second: string;
      let label: string;
      if (args.id2) {
        const b = historyStack.find(e => e.id === args.id2);
        if (!b) return `History entry #${args.id2} not found.`;
        second = b.pattern;
        label = `#${args.id2}`;
      } else {
        second = await ctx.getCurrentPatternSafe(sid);
        label = 'current';
      }

      return {
        pattern1: { id: args.id1, chars: first.pattern.length },
        pattern2: { id: label, chars: second.length },
        diff: generateDiff(first.pattern, second),
        summary: summarizeDiff(first.pattern, second),
      };
    }

    default:
      throw new Error(`history module does not handle tool: ${name}`);
  }
}

export const historyModule: ToolModule = { tools, toolNames, execute };
