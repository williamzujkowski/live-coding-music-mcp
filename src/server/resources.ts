/**
 * MCP resources — read-only catalogs the server exposes alongside tools.
 *
 * From #131 (originated as finding #6 in @nareto's audit #127): an agent
 * shouldn't have to spend tool calls just to discover what bundled
 * patterns exist or which styles the generator accepts. Surface those
 * catalogs as MCP resources so they can be listed once and reasoned
 * about without round-trips.
 *
 * Four resources:
 *   strudel://examples              — bundled patterns under patterns/examples
 *   strudel://patterns              — user-saved patterns from PatternStore
 *   strudel://styles                — supported genres + default BPM
 *   strudel://docs/tools            — tool quick-reference, one line each
 *
 * All payloads are JSON text. URIs are stable; content for examples and
 * styles is bundled with the build and effectively immutable per release.
 * Patterns is the only one that mutates at runtime.
 */

import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import type { PatternStore } from '../PatternStore.js';
import { diagnosticsModule } from './tools/diagnostics.js';
import { playbackModule } from './tools/playback.js';
import { storageModule } from './tools/storage.js';
import { historyModule } from './tools/history.js';
import { analysisModule } from './tools/analysis.js';
import { editorModule } from './tools/editor.js';
import { transformModule } from './tools/transform.js';
import { generateModule } from './tools/generate.js';
import { sessionModule } from './tools/session.js';
import { captureModule } from './tools/capture.js';
import { aiModule } from './tools/ai.js';
import { composeModule } from './tools/compose.js';

export interface ResourceContext {
  store: PatternStore;
  examplesDir: string;
}

export interface ResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const resources: ResourceDescriptor[] = [
  {
    uri: 'strudel://examples',
    name: 'Bundled example patterns',
    description: 'Curated example patterns shipped with the server, organised by genre',
    mimeType: 'application/json',
  },
  {
    uri: 'strudel://patterns',
    name: 'Saved patterns',
    description: 'Patterns saved by the user via the `save` tool, with tags and timestamps',
    mimeType: 'application/json',
  },
  {
    uri: 'strudel://styles',
    name: 'Supported styles',
    description: 'Genres the generator accepts, with their default tempos',
    mimeType: 'application/json',
  },
  {
    uri: 'strudel://docs/tools',
    name: 'Tool quick-reference',
    description: 'Compact list of every registered MCP tool with a one-line description',
    mimeType: 'application/json',
  },
];

const resourceUris = new Set(resources.map(r => r.uri));

export function isResourceUri(uri: string): boolean {
  return resourceUris.has(uri);
}

/**
 * Default tempos for the supported style set. Kept in sync with
 * compose.ts:TEMPO_BY_STYLE — both grow together when a new genre
 * lands. Future cleanup (#120 aftermath): single source of truth.
 */
const STYLE_DEFAULTS: Record<string, number> = {
  techno: 130,
  house: 125,
  dnb: 174,
  ambient: 80,
  trap: 140,
  jungle: 160,
  jazz: 110,
  experimental: 120,
  dubstep: 140,
  trance: 138,
  breakbeat: 130,
  garage: 130,
  electro: 128,
  downtempo: 90,
  idm: 115,
};

const TOOL_MODULES = [
  editorModule,
  playbackModule,
  transformModule,
  generateModule,
  analysisModule,
  storageModule,
  historyModule,
  diagnosticsModule,
  composeModule,
  aiModule,
  captureModule,
  sessionModule,
];

async function readExamples(examplesDir: string): Promise<unknown> {
  const entries = await fs.readdir(examplesDir, { withFileTypes: true });
  const genres = entries.filter(e => e.isDirectory()).map(e => e.name);

  const items: Array<{
    name: string;
    genre: string;
    bpm: number;
    key: string;
    tags: string[];
    description?: string;
  }> = [];

  for (const genre of genres) {
    const dir = join(examplesDir, genre);
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(join(dir, file), 'utf-8');
        const data = JSON.parse(raw);
        items.push({
          name: data.name ?? basename(file, '.json'),
          genre: data.genre ?? genre,
          bpm: data.bpm,
          key: data.key,
          tags: data.tags ?? [],
          description: data.description,
        });
      } catch {
        // Skip malformed example files rather than failing the whole list.
      }
    }
  }

  items.sort((a, b) => a.genre.localeCompare(b.genre) || a.name.localeCompare(b.name));
  return { count: items.length, examples: items };
}

async function readSavedPatterns(store: PatternStore): Promise<unknown> {
  const patterns = await store.list();
  const items = patterns.map(p => ({
    name: p.name,
    tags: p.tags,
    timestamp: p.timestamp,
    contentPreview: p.content.length > 200 ? p.content.slice(0, 200) + '...' : p.content,
  }));
  return { count: items.length, patterns: items };
}

function readStyles(): unknown {
  const items = Object.entries(STYLE_DEFAULTS)
    .map(([name, defaultBpm]) => ({ name, defaultBpm }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { count: items.length, styles: items };
}

function readToolDocs(): unknown {
  const items = TOOL_MODULES.flatMap(m =>
    m.tools.map(t => ({ name: t.name, description: t.description })),
  );
  items.unshift({ name: 'init', description: 'Initialize Strudel in browser' });
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { count: items.length, tools: items };
}

export async function readResource(
  uri: string,
  ctx: ResourceContext,
): Promise<{ uri: string; mimeType: string; text: string }> {
  let data: unknown;
  switch (uri) {
    case 'strudel://examples':
      data = await readExamples(ctx.examplesDir);
      break;
    case 'strudel://patterns':
      data = await readSavedPatterns(ctx.store);
      break;
    case 'strudel://styles':
      data = readStyles();
      break;
    case 'strudel://docs/tools':
      data = readToolDocs();
      break;
    default:
      throw new Error(`Unknown resource URI: ${uri}`);
  }
  return {
    uri,
    mimeType: 'application/json',
    text: JSON.stringify(data, null, 2),
  };
}
