# Changelog

All notable changes to this MCP server will be documented in this file.

## [3.0.0] — multi-session, MCP resources, result envelope, tool consolidation

The biggest release since the rename. Everything in `2.0.x` still works during a deprecation window, but the protocol-visible response shape changed (see Breaking below).

### Breaking

- **Result envelope on every `tools/call` response.** Tool responses now wrap their output in a discriminated envelope inside the existing `content[0].text` field:
  - Success: `{ "ok": true, "data": ... }` (with optional `"empty": true` for valid-empty results)
  - Failure: `{ "ok": false, "errorCategory": "validation"|"transient"|"business"|"permission"|"internal", "isRetryable": boolean, "message": "..." }`

  Clients that previously displayed the inner text as plain prose to a human will now see JSON. Programmatic clients can branch on `errorCategory` / `isRetryable` instead of regex-matching free text. Filed as #130; designed off @nareto's audit in #127 (findings 4-5).

### Added

- **Multi-session browser support (#108, #142).** Every browser-touching tool accepts an optional `session_id`. Named sessions get isolated `StrudelController` instances, separate undo/redo/history stacks (#179), and separate `AudioCaptureService` instances (#180). Lifecycle via the `session` tool (`action=create|destroy|list|switch`). Max 5 concurrent sessions with 30-min idle eviction.
- **MCP resources (#131).** Server now advertises four read-only catalogs that agents can list and read without burning tool calls:
  - `strudel://examples` — bundled example patterns with metadata
  - `strudel://patterns` — saved patterns from `PatternStore`
  - `strudel://styles` — supported genres + default BPM
  - `strudel://docs/tools` — every registered tool with one-line description
- **Tool consolidation (#120).** 17 mergers shipped across four phases. Each consolidated tool sits alongside its legacy verb aliases during a deprecation window; aliases will be removed in v3.1.0 per #178. Highlights:
  - `pattern_store(action)` (was save/load/list) — resolves the `list`/`list_sessions` collision
  - `edit_pattern(mode)` (was write/append/insert/replace/clear)
  - `transform(op)` (was 8 verbs: transpose/reverse/stretch/quantize/humanize/swing/scale/vary)
  - `analyze(include[])` (was analyze + 4 detection verbs)
  - `history(action)` (was undo/redo/list_history/restore_history/compare_patterns)
  - `diagnostics(level)`, `playback(action)`, `effect(action)`, `shape(dimension)`, `audio_capture(action)`, `browser_window(action)`, `generate_part(role)`, `generate_rhythm(type)`, `music_theory(query)`, `session(action)`, `ai_assist(task)`
  - `compose` absorbs `generate_pattern` (deprecation only)
- **Four orphan local-engine tools registered (#124):** `validate_pattern_local`, `analyze_pattern_local`, `query_pattern_events`, `transpile_pattern` — they had complete handlers but were never in `tools/list`.
- **Branch protection check name corrected (#87).** Required CI context now matches the actual job (`build (22.x)` instead of `CI`), so PRs auto-merge through the normal flow.
- **Lint blocking in CI (#122).** Was `continue-on-error: true`; now blocks. Errors dropped from 84 to 0; warnings from 728 to ~163.
- **README tool table generated from source (#123).** Drift guarded by a Jest test plus the existing CI step.

### Refactored

- **`server.ts` split (#104, #133).** From 2963-line monolith to 507-line dispatcher; tool handlers live in `src/server/tools/<domain>.ts`. Each module exports `{ tools, toolNames, execute }`.
- **StrudelEngine pure helpers extracted (#107, #134).** Six pure functions (parseErrorLocation, getSuggestionsForError, checkCommonIssues, extractBpm, extractFunctionsUsed, calculateComplexity) live in `StrudelEngineHelpers.ts` and have direct Jest coverage — they were previously unreachable because `@strudel/*` is ESM and ts-jest emits CJS.
- **Dead `requiresInitialization()` pre-flight removed (#141).** Each module's `execute()` does its own session-aware init check.

### Fixed

- **Browser-test failures (#139).** Tempo and spectrum tests in `ExampleValidation.browser.test.ts` had stale assertions (one targeted a non-existent `.spectrum.bands` shape; another's 1500ms wait wasn't enough for headless audio sample accumulation). Bumped to 4500ms, softened the tempo bounds-check, fixed the spectrum shape to match the real `analysis.features.{bass,mid,treble}`. All 31 browser tests pass.
- **`GenerateExamples.test.ts` no longer mutates tracked fixtures (#129).** Test writes generated examples to a tmp dir per run.
- **Allstar bot opt-out (#87).** `.allstar/branch_protection.yaml` opts out of the stock policy that expects reviewer approvals (not viable on a single-maintainer repo).

### Numbers

- **84 tools** in `tools/list` (26 consolidated + 58 deprecated aliases that forward; net ~26 after #178 lands in 3.1.0)
- **4 MCP resources**
- **1771 tests** pass, 20 skipped (browser, skipped in CI), 0 fail
- **86.76% statement coverage / 77.32% branch coverage** (services were 100% / 100% on the migration helpers)
- **0 lint errors**, 163 warnings (mostly `any` in test mocks; lint is now blocking in CI)
- **`server.ts`: 2963 → 507 lines**

## [2.0.0] — relicense to AGPL-3.0-or-later

**License changed: MIT → AGPL-3.0-or-later.** Filed and resolved as #125.

### Why

This project imports `@strudel/core`, `@strudel/mini`, `@strudel/tonal`, and `@strudel/transpiler`, all AGPL-3.0 licensed by the upstream [Strudel project](https://codeberg.org/uzu/strudel). Publishing a combined work under MIT was incorrect — AGPL's §5 copyleft clause propagates to anything that combines with AGPL code (ESM `import` on npm-redistributed packages qualifies as "combining" in the same sense that linking does for GPL). The earlier MIT declaration was a mistake; v2.0.0 fixes it.

### What this means for you

- If you `import` from this package in a private tool: no change. AGPL only triggers on distribution / network service.
- If you fork, extend, or redistribute: your derivative must also be AGPL-3.0-or-later.
- If you serve it over a network so others can interact with it (AGPL §13): you must provide source to those users.

### Breaking

- `license` field in `package.json`: `MIT` → `AGPL-3.0-or-later`. Some tooling (Snyk, dependency dashboards, corporate policy scanners) will flag this as a license change — expected.
- No code changes, no API changes, no schema changes. Drop-in for every `1.x` user who can accept the license.

### Deprecation

`@williamzujkowski/live-coding-music-mcp@1.0.0` is deprecated on npm with a pointer to `2.0.0`. Install `^2.0.0` to get the corrected license.

## [1.0.0] — rename

**Project renamed:** `@williamzujkowski/strudel-mcp-server` → `@williamzujkowski/live-coding-music-mcp`.

The old package name borrowed the upstream project's brand ("strudel"). The upstream maintainer asked that third-party adapters not include "strudel" in their package name (see issue #97) so it's clear which project is the canonical one. Renamed to `live-coding-music-mcp` — descriptive of what the tool does without claiming a brand.

The README, keywords, and description still reference `strudel.cc` accurately — this adapter drives the Strudel REPL. Only the package / repo name changed.

### Breaking changes

- npm package `@williamzujkowski/strudel-mcp-server` is **deprecated**. Install `@williamzujkowski/live-coding-music-mcp` instead.
- GitHub repo renamed from `strudel-mcp-server` to `live-coding-music-mcp`. Old URLs redirect automatically.
- `bin` name changed from `strudel-mcp` to `live-coding-music-mcp`. Update your MCP client config.
- Internal MCP server identifier changed from `strudel-mcp-enhanced` to `live-coding-music-mcp`.
- Docker image/container names changed to match. Rebuild images.
- Version bumped to `1.0.0` to mark the rename as a clean break.

### Migration

```bash
# Uninstall old
npm uninstall -g @williamzujkowski/strudel-mcp-server

# Install new
npm install -g @williamzujkowski/live-coding-music-mcp

# Update MCP client config
# OLD:  "command": "strudel-mcp"
# NEW:  "command": "live-coding-music-mcp"
```

## [Unreleased — pre-rename, now 2.4.1 on old package name]

> 66 tools registered
> Since v2.4.1

### New Features

- add suggest_pattern_from_audio tool — AI-powered audio-to-pattern (#95)

### Fixed

- **fix: play tool now actually starts audio (#119)** — `play` was only
  putting Strudel in "warm" state (code evaluated, audio not started)
  because `Ctrl+Enter` alone doesn't resume the AudioContext on first
  invocation. `play()` now clicks the play button directly to establish
  the user gesture; `stop()` does the same. Added
  `--autoplay-policy=no-user-gesture-required` Chromium flag as insurance.
- **fix: pin @strudel/\* to 1.2.5** — `@strudel/core@1.2.6` imports
  `SalatRepl` from `@kabelsalat/web`, which does not export that symbol.
  Every CI run since the dependabot bump failed at the `validate` step.
  Pinned `core`, `mini`, `tonal`, `transpiler` to `1.2.5` (last clean
  release). Revisit when upstream ships a working 1.2.7+.
- ESLint config, test file names, Node version docs, CI improvements

### Changed

- **docs: maturity statement bumped from "experimental" to "beta" (#111)**.
  77% statement coverage, 1470 passing tests, hardened CI, real audio
  output verified. Stable tool schemas within minor versions. Known
  coverage gaps (`AudioCaptureService` 33%, `AudioAnalyzer` branch 48%)
  tracked as open issues.

### Refactored

- rename server, strip emoji, make docs evergreen

### Maintenance

- cleanup vestigial content + auto-generate tool docs
- **deps**: update all dependencies to latest LTS
- **deps**: update lockfile to resolve 12 security vulnerabilities
- add SECURITY.md and Nerq Trust badge
- **deps**: Bump hono in the npm_and_yarn group across 1 directory (#90)
- **deps**: Bump qs in the npm_and_yarn group across 1 directory (#89)
- **deps**: Bump @modelcontextprotocol/sdk (#86)

## [2.4.1] - 2026-02-01

### Fixed

- **MCP Protocol**: Fixed stdout pollution from @strudel imports breaking JSON-RPC communication (#85)
- **Chord Generation**: Fixed `generateChordProgression()` to produce valid Strudel syntax - `note("<C G Am F>")` instead of invalid `note("C" "G" "Am" "F")` (#85)
- **Documentation**: Corrected tool count from 66 to 65, updated test statistics

### Security

- Bump hono 4.11.4 → 4.11.7 (CVE fixes) (#84)

### Contributors

- @linxule - MCP compatibility and chord syntax fixes

## [2.4.0] - 2026-01-25

### New Features

#### Multi-Session Browser Support (#75)
- `SessionManager` for concurrent Strudel sessions with browser context isolation
- Max 5 concurrent sessions with 30-minute auto-cleanup timeout
- New MCP tools: `create_session`, `destroy_session`, `list_sessions`, `switch_session`
- Optional `session_id` parameter on existing tools for session targeting

#### MIDI Export (#74)
- `MIDIExportService` for exporting Strudel patterns to standard MIDI files
- `export_midi` tool with note name to MIDI number conversion
- Chord expansion support (major, minor, 7th, maj7, m7, dim, aug, etc.)

#### Audio Capture (#71, #72)
- `AudioCaptureService` with MediaRecorder integration
- New MCP tools: `start_audio_capture`, `stop_audio_capture`, `capture_audio_sample`

#### AI-Powered Pattern Feedback (#67, #73, #76)
- `GeminiService` for AI-powered music analysis via Google Gemini
- `get_pattern_feedback` MCP tool with Gemini integration
- `get_feedback` option added to compose workflow
- Application Default Credentials (ADC) support for Google Cloud auth
- Gemini CLI credential auto-detection from config files

#### Creative Tools
- `refine` - Iteratively improve patterns with specific instructions
- `set_energy` - Adjust pattern energy level (0-100)
- `jam_with` - Collaborate with AI to evolve patterns
- `shift_mood` - Transform pattern emotional character

#### New Music Genres (#52)
- `intelligent_dnb` - Intelligent drum and bass patterns
- `trip_hop` - Trip hop style patterns (Portishead, Massive Attack style)
- `boom_bap` - Classic boom bap hip hop patterns (DJ Premier style)

### Fixed
- Gemini CLI credential paths now check correct locations
- PerformanceMonitor falsy check bugs
- CodeMirror timing race condition (#54)
- StrudelController now uses `window.strudelMirror` API (strudel.cc compatibility fix)

### Security
- Removed `executeInStrudelContext()` - eliminated Function constructor injection vulnerability (#56)

### Documentation
- Updated all tool counts from 52 to 66
- Updated test counts from 704 to 1521
- Updated coverage from 69% to 78%
- Fixed file structure documentation to match actual codebase
- Updated CodeMirror API references to use strudelMirror

### Tests
- StrudelController coverage improved to 81.67% (#70)
- Comprehensive PatternValidator tests (#69)
- AudioAnalyzer algorithm validation tests
- ErrorRecovery comprehensive test suite
- Gemini integration and E2E tests
- 46 new tests for session management

### Dependencies
- Bumped `hono` (security update) (#55)
- Bumped `@modelcontextprotocol/sdk` (#53)
- Bumped `qs` (security update) (#51)
- Added `@tonejs/midi` for MIDI export
- Added `google-auth-library` for ADC support

## [2.3.0] - 2025-12-14

### New Features

#### Pattern History (#41)
- `list_history` - Browse pattern history with timestamps and previews
- `restore_history` - Restore previous patterns by ID
- `compare_patterns` - Line-by-line diff comparison between patterns

#### UX Improvements (#43)
- `compose` - One-shot pattern generation with auto-play
- `status` - Quick browser/playback state check
- `diagnostics` - Detailed system diagnostics
- `show_browser` - Bring browser window to foreground
- `screenshot` - Capture browser state
- `show_errors` - Display captured console errors

#### OIDC Publishing (#49)
- Updated npm publishing to use OIDC trusted publishing
- Added provenance attestation for supply chain security
- Created NPM_PUBLISHING.md documentation

### Improvements
- Docker optimization with .dockerignore and dependency pruning (#19)
- Pattern write verification to prevent cache sync issues (#47)
- Audio analyzer diagnostic hints for better debugging (#45)
- Pattern validation now triggers evaluation for error detection (#46)

### Security
- **CRITICAL**: Removed `executeInStrudelContext()` method (#56)
  - Used `new Function()` constructor which is equivalent to `eval()`
  - Method was not used in production code, only in tests
  - Pattern execution now uses safe `writePattern()` + `play()` path

### Documentation
- Updated README with accurate tool counts
- Fixed test counts and coverage documentation
- Added Prerequisites section with requirements table
- Added Quick Reference section for common commands
- Added Security section documenting validation and sandboxing
- Removed inaccurate claims from previous changelog entries

## [2.2.0] - 2025-12-12

### Added
- Browser integration tests with live Strudel.cc website
- Pattern validation and auto-fix functionality
- Performance monitoring utilities
- Error recovery with retry logic

### Technical
- EnhancedMCPServerFixed with improved browser state handling
- Pattern caching for generated patterns
- TypeScript strict mode compliance

## [2.1.0] - 2025-11-15

### Added
- Integration test framework
- Music theory engine (scales, chords, progressions)
- Pattern generator for multiple genres

## [2.0.0] - 2025-11-01

### Added
- 40+ MCP tools for music control
- Euclidean rhythm generation
- Audio analysis via Web Audio API

### Breaking Changes
- Restructured server architecture

## [1.0.0] - 2025-08-18

### Initial Release
- Basic MCP server implementation
- Core Strudel control tools (init, write, play, stop)
- Browser automation with Playwright
- Pattern storage system
