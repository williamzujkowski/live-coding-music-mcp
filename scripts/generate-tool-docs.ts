#!/usr/bin/env npx tsx
/**
 * Tool Documentation Generator
 *
 * Extracts tool names and descriptions from the MCP server source
 * and injects them into README.md between markers.
 *
 * Usage:
 *   npx tsx scripts/generate-tool-docs.ts          # inject into README.md
 *   npx tsx scripts/generate-tool-docs.ts check     # verify README is current
 */

/* eslint-disable no-console */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SERVER_PATH = join(ROOT, 'src/server/server.ts');
const TOOLS_DIR = join(ROOT, 'src/server/tools');
const README_PATH = join(ROOT, 'README.md');

const START_MARKER = '<!-- TOOLS:START -->';
const END_MARKER = '<!-- TOOLS:END -->';

interface Tool {
  name: string;
  description: string;
}

/**
 * A tool's `name` and everything between its `description:` and the
 * `inputSchema:` that follows.
 *
 * The description is an EXPRESSION, not a literal. Nineteen of the
 * twenty-eight tools concatenate theirs across several lines, and the
 * regex this replaces captured one quoted literal — so the table showed
 * the first line of each and dropped the rest, which for a consolidated
 * tool is precisely the part naming its `action`/`task`/`op` values
 * (#401).
 */
const TOOL_BLOCK = /name:\s*'([^']+)',\s*\n\s*description:\s*([\s\S]*?),?\s*\n\s*inputSchema:/g;

/** Every single-quoted literal in a concatenation, unescaped and joined. */
const QUOTED = /'((?:[^'\\]|\\.)*)'/g;

function extractToolsFromFile(path: string): Tool[] {
  const content = readFileSync(path, 'utf-8');
  const tools: Tool[] = [];

  for (const match of content.matchAll(TOOL_BLOCK)) {
    const name = match[1] ?? '';
    const description = [...(match[2] ?? '').matchAll(QUOTED)]
      .map(part => (part[1] ?? '').replace(/\\(['\\])/g, '$1'))
      .join('')
      .trim();
    if (name !== '' && name !== 'live-coding-music-mcp') {
      tools.push({ name, description });
    }
  }

  return tools;
}

function extractTools(): Tool[] {
  // Main server.ts still holds most tool defs; extracted per-domain modules
  // live under src/server/tools/ (see #104).
  const seen = new Set<string>();
  const tools: Tool[] = [];

  const pushUnique = (t: Tool) => {
    if (!seen.has(t.name)) {
      seen.add(t.name);
      tools.push(t);
    }
  };

  for (const t of extractToolsFromFile(SERVER_PATH)) pushUnique(t);

  try {
    for (const entry of readdirSync(TOOLS_DIR)) {
      if (!entry.endsWith('.ts') || entry === 'types.ts') continue;
      for (const t of extractToolsFromFile(join(TOOLS_DIR, entry))) pushUnique(t);
    }
  } catch {
    // tools/ dir may not exist yet mid-split
  }

  return tools;
}

function categorizeTools(tools: Tool[]): Map<string, Tool[]> {
  const categories = new Map<string, Tool[]>();

  const categoryMap: Record<string, string> = {
    init: 'Setup',
    edit_pattern: 'Pattern Editing', get_pattern: 'Pattern Editing',
    playback: 'Playback', set_tempo: 'Playback',
    pattern_store: 'Storage', import_midi: 'Storage',
    history: 'History',
    compose: 'Generation', generate_part: 'Generation', generate_rhythm: 'Generation',
    music_theory: 'Music Theory',
    transform: 'Transform', effect: 'Transform', shape: 'Transform',
    ai_assist: 'AI',
    analyze: 'Analysis', validate_pattern_runtime: 'Analysis',
    validate_pattern_local: 'Analysis', analyze_pattern_local: 'Analysis',
    query_pattern_events: 'Analysis', transpile_pattern: 'Analysis',
    session: 'Session',
    export_midi: 'Export', browser_window: 'Export',
    audio_capture: 'Audio',
    diagnostics: 'Debug',
  };

  for (const tool of tools) {
    const category = categoryMap[tool.name] ?? 'Other';
    const existing = categories.get(category) ?? [];
    existing.push(tool);
    categories.set(category, existing);
  }

  return categories;
}

function generateToolSection(tools: Tool[]): string {
  const categories = categorizeTools(tools);
  const lines: string[] = [START_MARKER, ''];
  lines.push(`**${String(tools.length)} tools** across ${String(categories.size)} categories:\n`);

  const order = [
    'Setup', 'Pattern Editing', 'Playback', 'Storage', 'History',
    'Generation', 'Music Theory', 'Transform', 'AI', 'Analysis',
    'Session', 'Export', 'Audio', 'Debug', 'Other',
  ];

  for (const cat of order) {
    const catTools = categories.get(cat);
    if (catTools === undefined) continue;
    lines.push(`<details><summary><strong>${cat}</strong> (${String(catTools.length)})</summary>\n`);
    lines.push('| Tool | Description |');
    lines.push('|------|-------------|');
    for (const t of catTools) {
      lines.push(`| \`${t.name}\` | ${t.description} |`);
    }
    lines.push('\n</details>\n');
  }

  lines.push(`_Auto-generated from source. ${String(tools.length)} tools registered._`);
  lines.push('', END_MARKER);
  return lines.join('\n');
}

/**
 * Every hand-written tool-count mention in README.md.
 *
 * The auto-generated table between the TOOLS markers is regenerated wholesale,
 * but these counts live in prose outside the markers and used to drift silently
 * (#221: badge said 27 while Quick Start said 26, so users "fixed" a non-problem).
 * Both `inject` and `check` run this list, so CI fails on drift instead of
 * shipping a README that contradicts itself.
 */
const COUNT_PATTERNS: { pattern: RegExp; replace: (n: number) => string }[] = [
  // Badge: [![Tools](https://img.shields.io/badge/tools-27-green.svg)]()
  { pattern: /tools-\d+-green/g, replace: n => `tools-${String(n)}-green` },
  // Feature bullet: - **27 MCP tools** covering ...
  { pattern: /\*\*\d+ MCP tools\*\*/g, replace: n => `**${String(n)} MCP tools**` },
  // Quick Start: You should see a JSON response listing **27 tools**.
  { pattern: /listing \*\*\d+ tools\*\*/g, replace: n => `listing **${String(n)} tools**` },
  // Troubleshooting snippet comment: # Should return JSON with 27 tools
  { pattern: /# Should return JSON with \d+ tools/g, replace: n => `# Should return JSON with ${String(n)} tools` },
];

function patchToolCounts(readme: string, count: number): string {
  let out = readme;
  for (const { pattern, replace } of COUNT_PATTERNS) {
    out = out.replace(pattern, replace(count));
  }
  return out;
}

function inject(): void {
  const tools = extractTools();
  console.log(`Found ${String(tools.length)} tools in source`);

  let readme = readFileSync(README_PATH, 'utf-8');
  const section = generateToolSection(tools);

  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1) {
    readme = readme.slice(0, startIdx) + section + readme.slice(endIdx + END_MARKER.length);
  } else {
    console.log('No markers found in README.md. Add <!-- TOOLS:START --> and <!-- TOOLS:END --> markers.');
    return;
  }

  // Keep every hand-written count in sync with the generated table (#221)
  readme = patchToolCounts(readme, tools.length);

  writeFileSync(README_PATH, readme);
  console.log(`Injected ${String(tools.length)} tools into README.md`);
}

function check(): void {
  const tools = extractTools();
  const readme = readFileSync(README_PATH, 'utf-8');
  const expected = generateToolSection(tools);

  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    console.error('No tool markers found in README.md');
    process.exit(1);
  }

  const current = readme.slice(startIdx, endIdx + END_MARKER.length);
  if (current !== expected) {
    console.error(`Tool documentation drift detected (${String(tools.length)} tools in source)`);
    console.error('Run: npx tsx scripts/generate-tool-docs.ts');
    process.exit(1);
  }

  // Hand-written counts outside the markers drift too (#221).
  if (patchToolCounts(readme, tools.length) !== readme) {
    console.error(`Tool count drift outside the generated table (${String(tools.length)} tools in source)`);
    console.error('Run: npx tsx scripts/generate-tool-docs.ts');
    process.exit(1);
  }

  console.log(`Tool documentation current: ${String(tools.length)} tools`);
}

const command = process.argv[2];
if (command === 'check') {
  check();
} else {
  inject();
}
