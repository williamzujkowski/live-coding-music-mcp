# live-coding-music-mcp — Development Guide for LLMs

> Unofficial fan project. Drives [strudel.cc](https://strudel.cc/) (the canonical Strudel REPL — see [codeberg.org/uzu/strudel](https://codeberg.org/uzu/strudel)) via MCP. Not affiliated with the upstream Strudel project.

## Tone and Style Guidelines

When writing documentation, code comments, commit messages, or any project communication, adopt a **polite but direct Linus Torvalds** tone:

### Core Principles
1. **Technical Accuracy Over Everything**
   - Never exaggerate capabilities or test coverage
   - Never claim "production-ready" unless it genuinely is
   - Be precise: "52% statement coverage" not "comprehensive testing"
   - If something is broken, say it's broken

2. **Direct Communication**
   - "This doesn't work" instead of "This might not work in some cases"
   - "Wrong approach" instead of "Perhaps we could consider alternatives"
   - "Fix this" instead of "It would be nice if we could improve this"
   - But always explain *why* something is wrong

3. **Respectful Directness**
   - Attack the code, never the coder
   - "This implementation is inefficient" ✅
   - "You don't know what you're doing" ❌
   - Explain the issue, suggest better solutions

4. **High Standards, Zero Tolerance for BS**
   - No marketing speak in technical docs
   - No unnecessary buzzwords
   - No claiming features that don't exist
   - If it's experimental, label it experimental
   - If it's a hack, call it a hack

5. **Clarity Beats Politeness**
   - Be blunt when needed for clarity
   - Don't soften technical criticism with fluffy language
   - "This won't scale" > "This might face some scalability challenges"
   - But provide context and alternatives

### Examples

**Good (Polite Linus):**
```
This browser automation approach is the wrong solution.
Direct CodeMirror API access is 80% faster and doesn't
break on keyboard layout differences. See lines 92-102
for the correct implementation.
```

**Bad (Too Soft):**
```
While the browser automation works, we might want to
consider perhaps exploring the possibility of using
direct API access, which could potentially improve
performance in some scenarios.
```

**Bad (Too Harsh):**
```
Whoever wrote this clearly has no idea about performance.
This is garbage code that should never have made it past
code review.
```

### Documentation Standards
- State what the code *actually* does, not what you wish it did
- Test coverage numbers must be accurate
- "Open source, actively developed" > "Production-ready enterprise solution"
- Mention known issues and limitations upfront
- Welcome contributions but don't claim the project is perfect

## Context and Efficiency Guidelines

**Core Rule:** Context is a finite resource. Be efficient, direct, and avoid waste.

### Context Management Principles

1. **Track Token Usage**
   - Monitor token consumption throughout sessions
   - Warning threshold: 150K/200K tokens (75%)
   - Critical threshold: 180K/200K tokens (90%)
   - Use `/compact` when approaching limits

2. **Efficient Communication**
   - No verbose explanations when brief answers suffice
   - Don't repeat information already stated
   - Use references ("see line 42") instead of quoting code blocks
   - Summarize instead of listing when appropriate

3. **Tool Call Optimization**
   - Read files once, not repeatedly
   - Use parallel tool calls when operations are independent
   - Cache file contents mentally for the conversation
   - Use `git diff` not full file reads for checking changes

4. **State Awareness**
   - Before taking action, check current state (git status, gh issue list)
   - Don't assume - verify with minimal commands
   - Mark completed work immediately to avoid duplication
   - Track work state with TodoWrite for multi-step tasks

5. **Session Hygiene**
   - Start sessions by checking: git status, open issues, recent commits, CI status
   - Close sessions by: committing work, closing issues, verifying CI, cleaning todos
   - Don't create intermediate planning files (use GitHub Issues)
   - Commit frequently to avoid large context-heavy diffs

### Anti-Patterns (Avoid These)

❌ **Verbose Explanations**
```
I'm going to read the file to understand its current structure, then
I'll analyze the content to determine where the best location would be
to insert the new section, and then I'll carefully craft the edit...
```

✅ **Direct Action**
```
Adding context guidelines to CLAUDE.md after line 70.
```

❌ **Repeated File Reads**
```
[reads file] ... [makes edit] ... [reads file again] ... [makes another edit]
```

✅ **Single Read, Multiple Edits**
```
[reads file once] ... [makes all necessary edits in sequence]
```

❌ **Unnecessary Verification**
```
[runs test] ... [reads test output file] ... [runs test again] ... [checks git status]
```

✅ **Trust and Verify Once**
```
[runs test] ... [checks CI workflow] ... done
```

### Context Budget Guidelines

| Session Phase | Context Budget | Actions |
|---------------|----------------|---------|
| Startup | 10-20K tokens | Git status, issue list, recent commits, CI status |
| Planning | 20-40K tokens | Create todos, read key files, design approach |
| Implementation | 40-150K tokens | Code changes, tests, commits |
| Verification | 150-180K tokens | CI monitoring, issue closing, cleanup |
| Wrap-up | 180-200K tokens | Final summary, compact if needed |

**If exceeding budget:** Stop, commit work, close completed issues, `/compact`, continue in fresh session.

## Project Purpose
This is an **open source, actively developed** MCP server enabling AI agents to generate music via Strudel.cc using browser automation.

**Current State:** Beta. 1709 tests pass, 20 skipped (browser), 0 fail. 86.32% statement / 75.93% branch coverage. CI hardened (Scorecard, SHA-pinned actions, CODEOWNERS, Dependabot, lint blocking). Tool schemas are stable within minor versions. Multi-session shipped (v3.0.0 / #108) — sessions have isolated browser, history, and audio capture state. v4.0.0 removed the 58 deprecated tool aliases from #120 (#178). See GitHub Issues for the roadmap. Contributions welcome.

## GitHub Issues Workflow

**Core Rule:** GitHub Issues are the single source of truth for all work tracking. Planning documents in the repository will be rejected.

### When to Create Issues

**REQUIRED (create issue first):**
- New features (>50 LOC)
- Architecture changes
- New dependencies
- Breaking changes
- Multi-file refactors
- Performance optimizations
- Security fixes

**OPTIONAL (direct commit OK):**
- Typo fixes (<10 LOC)
- Comment improvements
- Single-function bug fixes (<20 LOC)
- Test additions (no code changes)

### Issue Labels

**Category** (required): `bug`, `feature`, `enhancement`, `testing`, `docs`, `refactor`, `performance`, `security`
**Priority** (required): `critical`, `high`, `medium`, `low`

### Issue Template

Every issue must include:
- Clear description
- Component affected
- Acceptance criteria (checkboxes)
- Testing requirements
- Workflow monitoring step

### Pre-Commit Check

Before closing ANY issue:
```bash
# Check for planning docs
git status --short | grep -E "(TDD_|PLANNING_|FUTURE_|OPTIMIZATION_|.*_REPORT\.md)"
# If found → DELETE or convert to issues

# Create follow-on issues
gh issue create --title "Follow-up: ..." --label "enhancement,medium"

# Close with verification
gh issue close <number> --comment "✅ Tests pass, build succeeds, no planning docs"
```

### Forbidden Files

**NEVER commit:** `TDD_*.md`, `PLANNING_*.md`, `FUTURE_*.md`, `OPTIMIZATION_*.md`, `*_REPORT.md`, `*_GUIDE.md`, `*_PLAN.md`

Use GitHub Issues instead. Planning documents clutter the repo and become stale immediately.

### Commit Message Format

Reference issues in commits:
```bash
git commit -m "feat: Add tempo detection (#123)

Implements FFT-based BPM detection.
Closes #123"
```

## Core Architecture

```
MCP Protocol Layer (26 tools + 4 resources)
    ↓ dispatcher in src/server/server.ts
Per-domain tool modules (src/server/tools/*.ts)
    ↓
Services: MusicTheory, PatternGenerator, SessionManager,
          AudioCaptureService, GeminiService, MIDIExportService,
          StrudelEngine
    ↓
Controllers: StrudelController, AudioAnalyzer
    ↓
Storage: PatternStore (on-disk JSON)
    ↓
Integration: Playwright → Strudel.cc
```

## Key Components

### 1. StrudelMCPServer (`src/server/server.ts`, ~510 lines)
- **Purpose**: MCP protocol handling, dispatch to per-domain tool modules, response envelope wrapping
- **Tools**: 26 registered (consolidated; #120 introduced the canonical shape in v3.0.0, #178 removed the deprecated aliases in v4.0.0)
- **Resources**: 4 MCP resources (#131) — examples, patterns, styles, tool docs
- **Key Methods**: `setupHandlers()`, `dispatchToolCall()`, `executeTool()` (thin), `getHistoryBundle()`, `getAudioCaptureService(sid)`
- **State**: per-session history bundles (`historyBundles: Map<sid, ...>`), per-session capture services (`audioCaptureServices: Map<sid, ...>`), pattern cache

### 2. StrudelController (`src/StrudelController.ts`)
- **Purpose**: Browser automation via Playwright
- **Key Methods**: `initialize()`, `writePattern()`, `play()`, `stop()`, `getCurrentPattern()`
- **Optimizations**: Editor caching (100ms TTL), resource blocking, direct CodeMirror API access
- **Location**: Lines 71-80 use CodeMirror internal API `.__view` for performance

### 3. AudioAnalyzer (`src/AudioAnalyzer.ts`)
- **Purpose**: Real-time FFT audio analysis and music information retrieval
- **Key Methods**: `inject()`, `getAnalysis()`, `detectTempo()`, `detectKey()`, `analyzeRhythm()`
- **Features**:
  - Frequency analysis (bands, spectral centroid, brightness)
  - Tempo detection (onset-based, 40-200 BPM range)
  - Key detection (Krumhansl-Schmuckler algorithm, 7 scale types)
  - Rhythm analysis (complexity, density, syncopation, regularity)
- **Caching**: 50ms TTL, dual-layer (browser + server)
- **Algorithms**: Autocorrelation, spectral flux, chroma extraction

### 4. MusicTheory (`src/services/MusicTheory.ts`)
- **Purpose**: Music theory calculations
- **Features**: 15+ scales, 8+ chord progressions, Euclidean rhythms
- **Key Methods**: `generateScale()`, `generateChordProgression()`, `euclid()`

### 5. PatternGenerator (`src/services/PatternGenerator.ts`)
- **Purpose**: Genre-based pattern generation
- **Styles**: techno, house, dnb, ambient, trap, jungle, jazz, experimental
- **Key Methods**: `generateCompletePattern()`, `generateDrums()`, `generateBassline()`

### 6. PatternStore (`src/PatternStore.ts`)
- **Purpose**: JSON-based pattern persistence
- **Security**: Path traversal protection in `sanitizeFilename()`
- **Caching**: Map-based pattern cache, list cache (5s TTL)

### 7. Utility Classes (`src/utils/`)
- **PatternValidator**: Syntax validation, auto-fix, safety checks
- **ErrorRecovery**: Retry logic with exponential backoff
- **PerformanceMonitor**: Operation timing, bottleneck detection
- **Logger**: Structured logging

## Performance Characteristics

| Operation | Latency | Notes |
|-----------|---------|-------|
| Page Load | 1.5-2s | With resource blocking |
| Pattern Write | 50-80ms | Cached editor access |
| Pattern Read (cached) | 10-15ms | 100ms TTL |
| Play/Stop | 100-150ms | Keyboard shortcuts |
| Audio Analysis | 10-15ms | FFT with typed arrays |
| Tempo Detection | <100ms | Onset-based, 90%+ accuracy |
| Key Detection | <100ms | Krumhansl-Schmuckler algorithm |
| Rhythm Analysis | <100ms | Complexity, density, syncopation |

## Development Workflow

### Building
```bash
npm run build          # TypeScript compilation
npm run validate       # Test MCP protocol
```

### Testing
```bash
npm test              # Run Jest tests
npm run test:watch    # Watch mode
```

### Adding New Tools

Tools live in `src/server/tools/<domain>.ts` modules, each exporting `{ tools, toolNames, execute }`. `server.ts` just dispatches.

1. Pick the right domain module (or add a new one if no fit). Add the tool definition to the module's `tools` array:
   ```typescript
   export const tools: Tool[] = [
     // ...
     {
       name: 'your_tool',
       description: 'One-line description; LLMs read this to pick between adjacent tools',
       inputSchema: {
         type: 'object',
         properties: {
           param: { type: 'string', description: 'What it is' },
         },
         required: ['param'],
       },
     },
   ];
   ```

2. Add the case to the module's `execute()` switch:
   ```typescript
   case 'your_tool':
     return await ctx.controller.yourMethod(args.param);
   ```

3. Add service method if needed (`MusicTheory`, `PatternGenerator`, etc.) and surface it through `ToolContext` (`src/server/tools/types.ts`) if other modules need it.

4. **Don't hand-edit the README tool table.** It's auto-generated. `npm run build` regenerates it via `scripts/generate-tool-docs.ts`. A Jest test (`src/__tests__/unit/ToolDocsDrift.test.ts`) and a CI step both guard against drift — if either fails, run `npm run build` and commit the regenerated `README.md`.

5. If the tool needs the browser, every module's `execute()` already checks `ctx.isInitialized()` — follow the existing pattern. For tools that don't need the browser (local-engine tools etc.), branch on a per-module allow-set; see `analysis.ts:LOCAL_ENGINE_TOOLS`.

### Code Standards
- TypeScript strict mode required
- JSDoc for all public methods
- Error handling: try-catch with graceful degradation
- Async/await patterns (no callbacks)
- Security: Validate all user inputs

## Common Patterns

### Browser Automation
```typescript
// Direct strudelMirror API manipulation (fast)
await this.page.evaluate((pattern) => {
  const sm = (window as any).strudelMirror;
  if (sm?.editor?.dispatch) {
    const view = sm.editor;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: pattern }
    });
  }
}, patternCode);
```

### Error Recovery
```typescript
import { ErrorRecovery } from './utils/ErrorRecovery';

const result = await ErrorRecovery.withRetry(
  async () => await riskyOperation(),
  { maxRetries: 3, baseDelay: 1000 }
);
```

### Pattern Validation
```typescript
import { PatternValidator } from './utils/PatternValidator';

const validation = PatternValidator.validate(pattern, true); // auto-fix
if (!validation.isValid) {
  console.error('Validation errors:', validation.errors);
  const fixed = validation.fixed; // Auto-fixed version
}
```

## Known Issues & Limitations

### Current Limitations
- Multi-session is supported (#108, v3.0.0): each `session_id` gets its own browser page, undo/redo/history, and audio capture. Max 5 concurrent sessions, 30-min idle eviction. Browser process is still shared across sessions (one Chromium, multiple contexts).
- Tempo detection accuracy degrades under headless audio — onset sampling is flakier than in a real browser. Key detection (Krumhansl-Schmuckler) is best-effort.
- History bounded to 100 entries per session (`MAX_HISTORY` constant).
- Browser tests require Playwright and are skipped in CI.
- The deprecated tool aliases left by #120 were removed in v4.0.0 (#178). Tool calls using the old verb names (e.g. `write`, `play`, `detect_tempo`) now return an error.

### Security Considerations
- Pattern validation prevents dangerous patterns (gain > 2.0, eval blocks)
- Path traversal protection in PatternStore
- Browser runs in sandbox
- No credential storage

## File Structure
```
src/
├── index.ts                    # Entry point
├── StrudelController.ts        # Browser automation (~800 lines)
├── AudioAnalyzer.ts            # Audio analysis (~800 lines)
├── PatternStore.ts             # On-disk JSON persistence
├── server/
│   ├── server.ts                    # MCP dispatcher (~510 lines, post-#104)
│   ├── resources.ts                 # MCP resources (#131)
│   └── tools/                       # Per-domain handlers (#104)
│       ├── ai.ts, analysis.ts, capture.ts, compose.ts,
│       ├── diagnostics.ts, editor.ts, generate.ts, history.ts,
│       ├── playback.ts, session.ts, storage.ts, transform.ts,
│       └── types.ts                 # ToolContext, Envelope, helpers
├── services/
│   ├── MusicTheory.ts          # Scale/chord/euclidean helpers
│   ├── PatternGenerator.ts     # Template-based generation (~680 lines)
│   ├── GeminiService.ts        # Gemini API client (ai_assist)
│   ├── SessionManager.ts       # Multi-session lifecycle (#108)
│   ├── AudioCaptureService.ts  # Audio recording (per-session, #180)
│   ├── StrudelEngine.ts        # @strudel/* wrapper
│   └── StrudelEngineHelpers.ts # Pure helpers (#107, direct-tested)
│   └── MIDIExportService.ts    # MIDI export
├── utils/
│   ├── Logger.ts               # Logging (22 lines)
│   ├── PatternValidator.ts     # Validation (286 lines)
│   ├── ErrorRecovery.ts        # Error handling (338 lines)
│   ├── PerformanceMonitor.ts   # Monitoring (156 lines)
│   └── InputValidator.ts       # Input validation (321 lines)
└── __tests__/                  # Jest tests
```

## Testing Strategy
- **Unit Tests**: MusicTheory, PatternGenerator (100% coverage)
- **Integration Tests**: StrudelController, PatternStore (77-85% coverage)
- **Mock Infrastructure**: MockPlaywright, TestFixtures
- **Coverage Target**: 80% overall, 100% for services

## Debugging Tips
```bash
# Verbose logging
DEBUG=* node dist/index.js

# Test specific tool
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"generate_part","arguments":{"role":"drums","style":"techno"}},"id":1}' | node dist/index.js

# Browser debugging (headful mode)
# Set headless: false in config

# Performance monitoring
# Use diagnostics({ level: "perf" }) via MCP
```

## Critical Code Locations

### Security-Critical
- `PatternStore.sanitizeFilename()` - Path traversal protection
- `PatternValidator.validate()` - Dangerous pattern detection
- `StrudelController.writePattern()` - Input validation entry point

### Performance-Critical
- `StrudelController.getCurrentPattern()` - Editor caching
- `AudioAnalyzer.getAnalysis()` - FFT optimization
- `PatternStore.list()` - Parallel file reading

### Integration Points
- `StrudelController.initialize()` - Browser setup, resource blocking
- `AudioAnalyzer.inject()` - Web Audio API monkey-patching
- `StrudelMCPServer.executeTool()` - Tool routing

## When Making Changes

### Before Committing
1. Run `npm run build` - Verify TypeScript compilation
2. Run `npm test` - Ensure tests pass
3. Run `npm run validate` - Test MCP protocol
4. Update README.md if adding tools
5. Add JSDoc to new public methods

### Performance Guidelines
- Cache frequently accessed data (TTL 50-100ms for real-time, 5s for static)
- Use parallel operations (`Promise.all`) for I/O
- Prefer direct DOM manipulation over keyboard simulation
- Block unnecessary resources in Playwright

### Security Guidelines
- Validate all user inputs
- Sanitize filenames with `path.basename()`
- Limit numeric ranges (BPM: 20-300, gain: 0-2)
- No eval/Function constructors
- Check array bounds

## Coding Standards

Comprehensive development standards adapted from [williamzujkowski/standards](https://github.com/williamzujkowski/standards/blob/master/docs/standards/CODING_STANDARDS.md).

### 1. Code Style and Formatting

**TypeScript/JavaScript Standards:**
- Follow Airbnb JavaScript Style Guide
- Line length: 100 characters maximum
- Indentation: 2 spaces
- Use semicolons
- Single quotes for strings

**Naming Conventions:**
- Classes: `PascalCase` (e.g., `StrudelController`, `AudioAnalyzer`)
- Functions/methods: `camelCase` verbs (e.g., `analyzeAudio()`, `detectTempo()`)
- Variables: `camelCase` nouns (e.g., `isPlaying`, `editorCache`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `CACHE_TTL`, `ONSET_THRESHOLD`)
- Private members: underscore prefix `_page`, `_browser`
- Types/Interfaces: `PascalCase` (e.g., `TempoAnalysis`, `ValidationResult`)

**Automation:**
- TypeScript compiler (`tsc`) enforces types
- Prettier for formatting (configured in `.prettierrc`)
- Pre-commit hooks validate build

### 2. Documentation Standards

**Required for All Public Methods:**
```typescript
/**
 * Detects the tempo (BPM) of currently playing audio
 * @param page - Playwright page instance
 * @returns Tempo analysis with BPM, confidence, method
 * @throws {Error} When audio analyzer not connected
 * @example
 * const tempo = await analyzer.detectTempo(page);
 * console.log(`Detected ${tempo.bpm} BPM`);
 */
async detectTempo(page: Page): Promise<TempoAnalysis> {
```

**System Documentation:**
- Architecture: See "Core Architecture" section in CLAUDE.md
- API: Tool descriptions in server.ts
- Deployment: README.md installation section
- Examples: `patterns/examples/README.md`

### 3. Error Handling

**Error Message Standards:**
- Be specific: "Browser not initialized. Run init tool first." not "Not initialized"
- Include action: Tell user what to do
- Add context: Include relevant parameters (BPM, filename, etc.)

**Exception Handling:**
```typescript
// Good - specific, actionable
if (!this._page) {
  throw new Error('Browser not initialized. Run init tool first.');
}

// Good - preserve context
try {
  await riskyOperation();
} catch (error: any) {
  this.logger.error('Operation failed', { context, error });
  throw new Error(`Operation failed: ${error.message}`);
}

// Bad - generic, unhelpful
if (!this._page) throw new Error('Error');
```

**Error Recovery:**
- Use `ErrorRecovery` class for retries (lines 17-335 in ErrorRecovery.ts)
- Exponential backoff for browser operations
- Circuit breakers for external resources (Strudel.cc)

### 4. Security Best Practices

**Input Validation:**
```typescript
// Always validate MCP tool inputs
const bpm = args.bpm ?? 120;
if (bpm < 20 || bpm > 300) {
  throw new Error(`Invalid BPM: ${bpm}. Must be 20-300.`);
}
```

**Pattern Safety:**
```typescript
// Prevent dangerous patterns
if (pattern.match(/gain\s*\(\s*[3-9]|gain\s*\(\s*[1-9]\d/)) {
  return { valid: false, errors: ['Dangerous gain level detected'] };
}
```

**File Operations:**
```typescript
// Always sanitize filenames (PatternStore.ts:52)
const sanitized = path.basename(filename);
if (sanitized !== filename) {
  throw new Error('Invalid filename - path traversal detected');
}
```

**NIST Control Tagging:**
When implementing security controls, tag with NIST 800-53r5:
```typescript
// @nist si-10 "Input validation"
validatePatternInput(pattern: string): ValidationResult {
  // Validate pattern syntax, dangerous constructs
}

// @nist ac-3 "Access enforcement"
// @nist ac-6 "Least privilege"
checkFileAccess(filePath: string): boolean {
  // Ensure file is within allowed directory
}
```

### 5. Performance Optimization

**Targets (from Performance Characteristics section):**
- Pattern write: <80ms
- Pattern read (cached): <15ms
- Audio analysis: <15ms (FFT)
- Tempo detection: <100ms
- Key detection: <100ms

**Caching Strategy:**
```typescript
// Short TTL for real-time data
private readonly ANALYSIS_CACHE_TTL = 50; // ms

// Longer TTL for static data
private readonly LIST_CACHE_TTL = 5000; // ms

// Check cache before expensive operation
if (this.editorCache && (now - this.cacheTimestamp) < this.CACHE_TTL) {
  return this.editorCache;
}
```

**Resource Optimization:**
- Block unnecessary resources (images, fonts) in Playwright (StrudelController.ts:61-68)
- Use `Promise.all` for parallel I/O (PatternStore.ts:95-109)
- Direct CodeMirror API > keyboard simulation (80% faster)

### 6. Testing Standards

**Test Coverage Requirements:**
- Overall: 80% statement coverage minimum
- Services (MusicTheory, PatternGenerator): 100% coverage
- Controllers (StrudelController): 70%+ coverage
- Integration tests: Key workflows covered

**Test Organization:**
```
src/__tests__/
├── unit/                    # Unit tests (fast)
│   ├── MusicTheory.test.ts
│   └── PatternGenerator.test.ts
├── integration/             # Integration tests (medium)
│   ├── E2E.integration.test.ts
│   └── MCPServer.integration.test.ts
├── validation/              # Validation tests (slow)
│   ├── GenreValidation.test.ts
│   └── GenerateExamples.test.ts
└── browser/                 # Real browser tests (slowest)
    └── ExampleValidation.browser.test.ts
```

**Test Naming:**
```typescript
describe('AudioAnalyzer - Tempo Detection', () => {
  it('should detect 120 BPM within ±2 BPM tolerance', async () => {
    // Test implementation
  });
});
```

### 7. API Design (MCP Tools)

**Tool Naming:**
- Use snake_case: `edit_pattern`, `generate_part`
- Consolidated tools take an enum discriminator (`action`/`mode`/`op`/`level`/`role`/`task`/`include`)
- Nouns for queries: `get_pattern`, `music_theory`

**Tool Design Principles:**
```typescript
// Good - clear parameters, documented return
{
  name: 'compose',
  description: 'Generate, write, and play a complete pattern in one step. Auto-initializes default browser if needed.',
  inputSchema: {
    type: 'object',
    properties: {
      style: { type: 'string', description: 'Genre (techno, house, dnb, etc.)' },
      key: { type: 'string', description: 'Musical key (C, D, E, etc.)' },
      tempo: { type: 'number', description: 'Tempo in BPM' }
    },
    required: ['style']
  }
}
```

**Return Values — the MCP-level envelope (#130):**

Every tool call surfaces to MCP clients wrapped in a discriminated envelope. The dispatcher in `server.ts` does the wrapping; tools can either return raw values (auto-wrapped) or return envelopes natively via the helpers in `src/server/tools/types.ts`:

```typescript
import { ok, err, empty } from './types.js';

// success with data
return ok({ bpm: 174, confidence: 0.92, method: 'onset-based' });

// valid-empty result (call worked but nothing to return)
return empty([]);

// business-state failure (setup needed, don't retry)
return err('business', 'Browser not initialized. Run init first.');

// validation failure (caller passed bad input)
return err('validation', `Invalid BPM: ${bpm}. Must be 20-300.`);

// transient failure (retryable)
return err('transient', 'Strudel.cc request timed out', { isRetryable: true });
```

Wire-level shape MCP clients see:

```json
{ "ok": true,  "data": { ... } }
{ "ok": true,  "data": [],     "empty": true }
{ "ok": false, "errorCategory": "validation", "isRetryable": false, "message": "..." }
```

`errorCategory` is one of `validation` / `transient` / `business` / `permission` / `internal`. Tools that throw raw `Error`s get categorised by message via `categorizeError()` — fine for the common cases (`Invalid X`, `not found`, `not initialized`, `timeout`, ...), but tools that own a specific error condition should call `err(category, message)` directly so the categorisation isn't string-sniffed.

Module-level adoption is incremental: dispatch normalises legacy `'Browser not initialized...'` and `'Error: ...'` string returns into envelopes, so a tool can keep its current return shape until someone migrates it.

### 8. Dependency Management

**Dependency Selection Criteria:**
- License: MIT-compatible
- Maintenance: Active (updated within 6 months)
- Security: No known vulnerabilities
- Size: Minimize bundle size

**Version Pinning:**
```json
// package.json - exact versions for stability
"dependencies": {
  "playwright": "1.49.1",  // Exact version
  "@modelcontextprotocol/sdk": "^1.0.4"  // Patch updates OK
}
```

**Update Schedule:**
- Security updates: Immediate
- Minor updates: Monthly
- Major updates: Quarterly (with testing)

### 9. Version Control Practices

**Commit Message Format:**
```
type(scope): brief description (#issue)

Detailed explanation of changes.

- Change 1
- Change 2

Closes #123

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`

**Branch Strategy:**
- `main`: Production-ready code
- Feature branches: Short-lived, merged via PR
- No direct commits to main

### 10. Accessibility (Future)

**When Building UI:**
- Semantic HTML
- ARIA attributes
- Keyboard navigation
- Screen reader support
- WCAG 2.1 AA compliance

**Current State:** MCP server is CLI/API only, no UI. Apply when/if UI is added.

### 11. Concurrency and Parallelism

**Browser Operations:**
- One Chromium process; multiple Playwright `BrowserContext`s — one per session (#108)
- Within a session: writes are sequential (don't pipeline `writePattern` calls on the same controller)
- Across sessions: writes can interleave safely; each session has its own page and CodeMirror editor
- Parallel file I/O when safe (`PatternStore.list`)

**Thread Safety:**
```typescript
// Good - serialize browser operations
await this.writePattern(pattern1);
await this.writePattern(pattern2);

// Good - parallelize independent I/O
const results = await Promise.all([
  this.loadPattern('a'),
  this.loadPattern('b')
]);
```

### 12. Resource Management

**Browser Lifecycle:**
```typescript
// Acquire late
const controller = new StrudelController(headless);
await controller.initialize(); // Only when needed

// Release early
await controller.cleanup(); // Always cleanup
```

**Memory Management:**
- Clear caches on cleanup (StrudelController.cleanup)
- Limit history buffers (MAX_HISTORY_LENGTH = 100)
- Close browser properly

### 13. Code Review Standards

**Required Checks:**
- ✅ TypeScript compiles without errors
- ✅ All tests pass
- ✅ Code follows style guide
- ✅ Documentation complete
- ✅ No security issues
- ✅ Performance acceptable

**Review Focus:**
- Correctness of music theory (scales, chords, rhythms)
- Browser automation reliability
- Error handling completeness
- Test coverage

### 14. Sustainability and Green Coding

**Resource Efficiency:**
- Minimize browser reloads (reuse instance)
- Cache aggressively (reduce network calls)
- Block unnecessary resources (images, fonts)
- Use headless mode when possible

**Algorithm Efficiency:**
- O(n log n) FFT for audio analysis
- O(n) pattern validation
- Avoid O(n²) operations on large datasets

### 15. Refactoring Guidelines

**Refactoring Triggers:**
- Function >50 lines
- Cyclomatic complexity >10
- Duplicate code (DRY violation)
- Poor test coverage (<80%)

**Refactoring Process:**
1. Write tests for current behavior
2. Make small, incremental changes
3. Run tests after each change
4. Commit frequently
5. Update documentation

### 16. Internationalization (Future)

**When Adding i18n:**
- Extract user-facing strings
- Support multiple locales
- Handle date/time formatting
- Support different number formats

**Current State:** English only. Add i18n when demand exists.

## Common Troubleshooting

**Build fails**: `rm -rf dist && npm run build`
**Tests fail**: Check Node version (18+), run `npm install`
**Browser won't launch**: `npx playwright install chromium`
**Audio analysis stuck**: Verify audio is playing, check browser console
**Pattern validation errors**: Use auto-fix option, check syntax

## Architecture Decisions

**Why Playwright?** Strudel.cc is web-only, Playwright provides reliable automation
**Why JSON storage?** Simplicity, human-readable, sufficient for <10k patterns
**Why caching?** Strudel.cc interaction is slow (50-500ms), caching provides real-time UX
**Why direct CodeMirror access?** 80% faster than keyboard simulation

## UX Design Principles

This MCP server bridges AI-powered music generation with live-coding workflows. Follow these UX principles when developing features.

### Browser Window as Primary Interface

The Strudel browser window is NOT a hidden implementation detail—it's the **primary interface** for music creation.

**Key Principles:**
1. **Keep Window Visible**: Default `headless: false` in config.json. Users should see their patterns.
2. **Visual Feedback**: Pattern changes should be immediately visible in the browser editor.
3. **Persistent Session**: Browser stays open throughout the session for manual tweaking.
4. **Direct Interaction**: Users can edit patterns directly in the browser while using MCP tools.

**Why This Matters:**
- Live-coding environments (TidalCycles, Sonic Pi) keep editor windows always visible
- Users need to see code as they iterate
- Visual confirmation builds trust in the system
- Manual tweaking is essential for creative workflow

### Reduce Tool Call Friction

Users expect immediate results. Minimize the number of tool calls for common workflows.

**Pre-consolidation workflow (5 calls):**
```
init → generate_part → edit_pattern → playback → analyze
```

**Target Workflow (Good):**
```
compose (1 call with auto_play: true)
```

**Guidelines:**
- Add `auto_play` option to generation tools
- Initialize browser automatically when needed
- Combine related operations into single tools
- Return rich responses with pattern + metadata + status

### Surface Errors Early

Pattern errors should be visible immediately, not discovered when audio fails to play.

**Principles:**
1. Validate patterns before writing (use `PatternValidator`)
2. Include warnings in write responses
3. Surface console errors from Strudel
4. Provide actionable error messages with suggestions

**Example Response:**
```json
{
  "success": true,
  "pattern_length": 245,
  "warnings": ["High gain (3.0) may cause distortion"],
  "suggestions": ["Consider adding .room() for space"]
}
```

### Expose System State

Users should understand what the system is doing. Hidden state causes confusion.

**Expose:**
- Browser initialization status
- Playback state (playing/stopped)
- Cache status (valid/stale)
- Error count and last error
- Pattern history

**Tools to Support This:**
- `status` - Quick state check
- `diagnostics` - Detailed system info
- `list_history` - Browse pattern history

### Live Coding Workflow Expectations

Users coming from live-coding expect:

| Expectation | Implementation |
|-------------|---------------|
| See code immediately | Non-headless browser, pattern visible in editor |
| Hear changes instantly | Auto-play option, minimal latency |
| Undo mistakes easily | Undo/redo tools with visible history |
| Iterate rapidly | Single tool calls for common operations |
| Save work | Pattern storage with tags and metadata |

### Visual Feedback Checklist

When implementing new features, ensure:
- [ ] Operation result visible in browser window
- [ ] Error messages are actionable
- [ ] State changes are logged/observable
- [ ] Performance doesn't block UI (async operations)
- [ ] User can verify operation succeeded visually

### Related Issues

See GitHub issues for UX improvements:
- #37: Keep browser window visible and persistent
- #38: Add auto-play option for pattern writing
- #39: Add browser state and diagnostics tools
- #40: Surface pattern validation errors visually
- #41: Add pattern history browsing
- #42: Add high-level compose workflow

## Future Enhancements
- WebWorker audio analysis (run FFT off the main thread)
- SQLite pattern store (replace JSON-per-file when catalogs cross thousands)
- Improved modal scale detection accuracy
- Per-module envelope migration (#140 was closed as won't-do; revisit if a specific module benefits)
