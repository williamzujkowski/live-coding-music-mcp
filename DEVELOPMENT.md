# Development Guide

How to develop on live-coding-music-mcp. For the user-facing overview see the [README](README.md); for the system design see [ARCHITECTURE.md](ARCHITECTURE.md).

## Prerequisites

- Node.js 22+ (LTS) — see `engines` in `package.json`
- npm 10+
- Playwright Chromium (auto-installed)

## Setup

```bash
git clone https://github.com/williamzujkowski/live-coding-music-mcp.git
cd live-coding-music-mcp

npm install
npx playwright install chromium
npm run build
npm test
```

## Available scripts

```bash
npm run dev          # development mode with hot reload
npm run build        # tsc + regenerate README tool table
npm start            # run from dist/
npm test             # full Jest suite with coverage
npm run test:nocov   # full Jest suite without coverage
npm run test:watch   # Jest watch mode
npm run test:browser # browser-integration suite (HEADLESS=true)
npm run validate     # send tools/list, verify protocol response
npm run lint         # eslint (blocking — 0 errors required)
npm run format       # prettier
npm run clean        # remove dist/ and coverage/
```

## Validating the MCP server

```bash
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js
```

Expect a JSON response with 26 tools. If you see a different number, the build is out of date — run `npm run build`.

## Adding to Claude during development

```bash
claude mcp add strudel-dev node $(pwd)/dist/index.js
```

For Claude Desktop, point `command` at the local `dist/index.js` instead of the npm bin — see the README Quick Start for the JSON shape.

## Adding new tools

Tools live in per-domain modules under `src/server/tools/<domain>.ts`. `server.ts` just dispatches. To add a tool:

1. **Pick the right domain module** (or add a new one). Add the tool definition to that module's `tools` array:

   ```typescript
   export const tools: Tool[] = [
     // ...
     {
       name: 'my_new_tool',
       description: 'One-line description; agents read this to pick between adjacent tools',
       inputSchema: {
         type: 'object',
         properties: {
           param1: { type: 'string', description: 'What it is' },
           session_id: { type: 'string', description: 'Optional session ID (#108)' },
         },
         required: ['param1'],
       },
     },
   ];
   ```

2. **Add the case** to the module's `execute()` switch:

   ```typescript
   case 'my_new_tool':
     return await ctx.getController(args.session_id).doSomething(args.param1);
   ```

3. **Add a service method** if needed (`MusicTheory`, `PatternGenerator`, etc.) and surface it through `ToolContext` (`src/server/tools/types.ts`) if other modules need it.

4. **Don't hand-edit the README tool table.** It auto-generates via `npm run build` → `scripts/generate-tool-docs.ts`. A Jest test (`ToolDocsDrift.test.ts`) plus a CI step guard against drift — both will fail loudly if the README is stale.

5. **Use the envelope helpers** for returns: `ok(data)`, `empty(data)`, `err('validation', 'message')` from `src/server/tools/types.ts`. Raw returns still work — the dispatcher normalises them — but native envelope construction is clearer.

6. **Build and test:**

   ```bash
   npm run build
   echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"my_new_tool","arguments":{"param1":"test"}},"id":2}' | node dist/index.js
   ```

## Testing

```bash
npm test                 # full suite with coverage
npm run test:watch       # interactive
npm run test:browser     # browser integration (skipped in CI)
```

Suite layout:

```
src/__tests__/
├── unit/         — fast, pure-function and per-module tests
├── integration/  — multi-component (MCP dispatch, sessions, e2e workflows)
├── validation/   — pattern/genre validation harnesses
└── browser/      — real-browser tests (require Chromium + audio)
```

Coverage target: 80% overall, 100% on services (MusicTheory, PatternGenerator). Browser tests are skipped in CI because they need Playwright + audio.

## Debugging

```bash
DEBUG=strudel:* npm start          # all subsystems
DEBUG=strudel:controller npm start # browser automation only
DEBUG=strudel:audio npm start      # audio analysis only
```

To watch the browser visibly during a test, set `headless: false` in `config.json` (it's the default anyway). For more aggressive Playwright debugging, add `devtools: true, slowMo: 100` to the `chromium.launch()` call in `StrudelController.ts`.

VS Code launch config:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug MCP Server",
  "program": "${workspaceFolder}/dist/index.js",
  "preLaunchTask": "npm: build",
  "console": "integratedTerminal",
  "env": { "DEBUG": "strudel:*" }
}
```

## Code quality

TypeScript strict mode is required. ESLint is blocking in CI — `npm run lint` must return 0 errors. Prettier is configured but advisory.

Standards in summary (see [CLAUDE.md](CLAUDE.md) for the full list):
- Airbnb-ish JS style; 2-space indent; 100-char line length; single quotes; semicolons
- `PascalCase` types/classes, `camelCase` functions/variables, `UPPER_SNAKE_CASE` constants, snake_case tool names
- JSDoc on public service methods; no comments restating obvious code
- All user inputs validated at the tool-entry boundary

## Contributing

1. Fork and clone:
   ```bash
   git clone https://github.com/YOUR_USERNAME/live-coding-music-mcp.git
   ```
2. Branch off `main`:
   ```bash
   git checkout -b feat/my-feature   # or fix/, docs/, refactor/, perf/, chore/
   ```
3. Make changes; add tests; ensure `npm test` passes; ensure `npm run lint` is clean; rebuild docs if you touched any tool definition (`npm run build` regenerates the README table).
4. Commit with Conventional Commits style:
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation
   - `refactor:` no behavior change
   - `test:` tests only
   - `perf:` performance
   - `chore:` maintenance
5. Push and open a PR. Reference any related issues with `Closes #N`.

For substantive work (>50 LOC, new dependencies, breaking changes), open a GitHub issue first — see [CLAUDE.md](CLAUDE.md) for the issue policy.

## Release process

See [NPM_PUBLISHING.md](NPM_PUBLISHING.md) for the canonical release flow. The short version:

1. Update `version` in `package.json` and add a CHANGELOG entry for the new version.
2. Commit, push, open a PR. Merge to `main` once CI is green.
3. Create a GitHub release for the new version tag — this fires the publish workflow (`workflow_dispatch` with `dry_run: false` for manual triggers, or `release: published` for tag-triggered runs).
4. The workflow does the rest: `npm publish --provenance`, SLSA build provenance attestation, SBOM generation (SPDX + CycloneDX), and attaches the tarball + SBOMs to the GitHub release.

Use `gh workflow run publish.yml --ref main -f dry_run=true` to validate the pipeline without publishing — added in #189 to catch publish-time regressions before they hit users.

## Docker

```bash
npm run docker:build
npm run docker:run
```

The Dockerfile produces a runnable container that exposes the MCP stdio interface. Useful for clients that prefer not to install Node locally.

## Environment variables

Most configuration lives in `config.json` (see README → Configuration). A few env vars are read directly:

```bash
LOG_LEVEL=debug              # debug, info, warn, error
GEMINI_API_KEY=...           # enables ai_assist tools
PATTERNS_DIR=./patterns      # override pattern storage location
HEADLESS=true                # used by test:browser script
```

The `audio_analysis` config block in `config.json` is wired to `AudioAnalyzer` (#195):

- `fft_size`: power of 2 in [32, 32768]. Default 1024.
- `smoothing`: number in [0, 1]. Default 0.8.

Invalid values fall back to defaults with a warning rather than throwing — bad config in a hand-edited `config.json` shouldn't crash the server. Frequency-band boundaries inside `AudioAnalyzer.analyze()` scale automatically with `fftSize`, so changing FFT size preserves the Hz range each band covers (just at higher or lower resolution).
