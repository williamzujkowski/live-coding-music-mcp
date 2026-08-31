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

**Current State:** Beta. `npm test` runs two tiers: ~3020 unit/integration tests in parallel, then 36 browser tests serially — they contend for Chromium and the live site, which made the combined parallel run flaky (#267). 20 skipped, 0 failing. <!-- COVERAGE:START -->88.99% statement / 79.99% branch coverage<!-- COVERAGE:END -->. CI hardened (Scorecard, SHA-pinned actions, CODEOWNERS, Dependabot, lint blocking). Tool schemas are stable within minor versions. Multi-session shipped (v3.0.0 / #108) — sessions have isolated browser, history, and audio capture state. v4.0.0 removed the 58 deprecated tool aliases from #120 (#178). See GitHub Issues for the roadmap. Contributions welcome.

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
MCP Protocol Layer (28 tools + 4 resources)
    ↓ dispatcher in src/server/server.ts
Per-domain tool modules (src/server/tools/*.ts)
    ↓
Services: MusicTheory, PatternGenerator, SessionManager,
          AudioCaptureService, GeminiService, MIDIExportService,
          MIDIImportService,
          StrudelEngine
    ↓
Controllers: StrudelController, AudioAnalyzer
    ↓
Isolation: IsolatedStrudelEngine → forked engineChild (heap cap + deadline)
    ↓
Storage: PatternStore (on-disk JSON)
    ↓
Integration: Playwright → Strudel.cc
```

## Key Components

### 1. StrudelMCPServer (`src/server/server.ts`, ~680 lines)
- **Purpose**: MCP protocol handling, dispatch to per-domain tool modules, response envelope wrapping
- **Tools**: 28 registered — 27 across the domain modules plus `init`, wired directly in `server.ts` (consolidated; #120 introduced the canonical shape in v3.0.0, #178 removed the deprecated aliases in v4.0.0)
- **Resources**: 4 MCP resources (#131) — examples, patterns, styles, tool docs
- **Key Methods**: `setupHandlers()`, `dispatchToolCall()`, `executeTool()` (thin), `getHistoryBundle()`, `getAudioCaptureService(sid)`
- **State**: per-session history bundles (`historyBundles: Map<sid, ...>`), per-session capture services (`audioCaptureServices: Map<sid, ...>`), pattern cache

### 2. StrudelController (`src/StrudelController.ts`)
- **Purpose**: Browser automation via Playwright
- **Key Methods**: `initialize()`, `writePattern()`, `play()`, `stop()`, `getCurrentPattern()`
- **Optimizations**: Editor caching (100ms TTL), resource blocking, direct CodeMirror API access
- **API**: Drives `window.strudelMirror` (`writePattern`, `getCurrentPattern`, `play`, `stop`). Note `editor.__view` on the DOM node is *not* exposed by strudel.cc — see the comment in `initialize()`

### 3. AudioAnalyzer (`src/AudioAnalyzer.ts`)
- **Purpose**: Real-time FFT audio analysis and music information retrieval
- **Key Methods**: `inject()`, `getAnalysis()`, `detectTempo()`, `detectKey()`, `analyzeRhythm()`
- **Features**:
  - Frequency analysis (bands, spectral centroid, brightness)
  - Tempo detection (onset-based, 40-200 BPM range)
  - Key detection (Krumhansl-Schmuckler with Pearson correlation, 7 scale types)
  - Rhythm analysis (complexity, density, syncopation, regularity)
- **Caching**: 50ms TTL, dual-layer (browser + server)
- **Algorithms**: Autocorrelation, spectral flux, chroma extraction

### 4. MusicTheory (`src/services/MusicTheory.ts`)
- **Purpose**: Music theory calculations
- **Features**: 14 scales, 8 chord progressions, Euclidean rhythms
- **Key Methods**: `generateScale()`, `generateChordProgression()`, `euclid()`

### 5. PatternGenerator (`src/services/PatternGenerator.ts`)
- **Purpose**: Genre-based pattern generation
- **Styles**: techno, house, dnb, breakbeat, trap, jungle, ambient, experimental, intelligent_dnb, trip_hop, boom_bap (plus aliases: liquid_dnb, atmospheric_dnb, bukem, triphop, ...). `jazz` is a bassline/harmony style only — it has no drum pattern and falls back to techno drums
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

Rows marked **measured** are covered by `src/__tests__/benchmarks/latency.benchmark.ts`
(`npm run benchmark`, gated in CI via `benchmark:gate`). The rest are single-machine
estimates — treat them as rough, not as guarantees.

| Operation | Latency | Source | Notes |
|-----------|---------|--------|-------|
| Page Load | 1.5-2s | measured | With resource blocking |
| Pattern Write | 50-80ms | measured | Cached editor access; `targetP95Ms: 80` |
| Pattern Read (cached) | 10-15ms | measured | 100ms TTL |
| Play/Stop | 100-150ms | measured | Via `strudelMirror.evaluate()`/`.stop()`, then state confirmed |
| Audio Analysis | 10-15ms | measured | FFT with typed arrays; `targetP95Ms: 15` |
| Tempo Detection | <100ms | measured | `targetP95Ms: 100`. Fast, but see Known Issues — it measures poll cadence, not audio (#322) |
| Key Detection | <100ms | measured | Krumhansl-Schmuckler with Pearson; `targetP95Ms: 100`. Accurate on all 24 canonical profiles; resolution-limited in the bass |
| Rhythm Analysis | <100ms | estimate | Complexity, density, syncopation |

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

**No named inner functions inside `page.evaluate`.** Playwright serializes
the function source and runs it in the browser. `tsx` transpiles with
esbuild's `keepNames`, which rewrites a named inner function into
`__name(fn, "fn")` — and `__name` does not exist in page context, so the
whole evaluate throws `ReferenceError: __name is not defined`. `tsc`
emits it untouched, so this breaks **only** under `npm run dev` and the
`test:sandbox` / `test:export-audio` scripts, never in production or CI.

Measured, not guessed — which forms survive:

| Inside `page.evaluate` | Safe? |
|---|---|
| `const fn = (x) => ...` | no |
| `function fn(x) {}` | no |
| `{ prop: () => ... }` | no |
| `{ method(x) {} }` | **yes** |
| `arr.map(x => ...)` | **yes** |

So put helpers in an object literal using method shorthand:

```typescript
await this.page.evaluate(() => {
  const h = {
    encode(bytes: Uint8Array): string { /* ... */ return ''; },
  };
  return h.encode(new Uint8Array());
});
```

`src/__tests__/unit/PageEvaluateNameWrapping.test.ts` enforces this,
including for functions passed by reference rather than written inline
(#248).

**Mark every `page.evaluate` argument `/* istanbul ignore next */`.** Same
hazard, different tool: Jest's coverage instrumentation injects `cov_*`
counters into functions matched by `collectCoverageFrom`, and `cov_*` does
not exist in page context either. This one is nastier to diagnose —
`waitForFunction` swallows the `ReferenceError` and polls until timeout,
so the symptom looks like strudel.cc being slow. It cost 31 browser tests,
which were skipped wholesale under `--coverage` until #256. The same test
enforces the pragma.

The general rule: a function heading for `page.evaluate` must survive
whatever the local toolchain injects into it. Two tools already inject
something; assume a third will.

### Error Recovery
```typescript
import { ErrorRecovery } from './utils/ErrorRecovery';

const recovery = new ErrorRecovery();
const result = await recovery.executeWithRetry(
  async () => await riskyOperation(),
  'Operation Name',
  { maxRetries: 3, retryDelay: 1000, exponentialBackoff: true }
);
```

**This example is aspirational, not descriptive.** `executeWithRetry` has
zero production callers. The only path into `ErrorRecovery` from live code
is `handlePatternWrite` (`StrudelController.ts:643`) plus `getErrorStats`
for diagnostics — eight of its ten public methods, including the circuit
breaker and the network-retry helper, are never invoked outside tests.
Note also that `ErrorRecovery.withRetry` — which this snippet claimed for
several releases — has never existed at all.

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

### Local engine isolation (#307)

`validate_pattern_local`, `analyze_pattern_local`, `query_pattern_events`
and `transpile_pattern` evaluate user code in a **forked child**, not in
the server process. One persistent child, forked on first use, reused,
respawned when it dies. Cold start ~200ms under `tsx`; warm round-trip
p95 ~1ms, both gated in `latency.benchmark.ts`.

Why a child and not a worker: measured. A `worker_threads` worker that
blows `resourceLimits.maxOldGenerationSizeMb` inside an allocating
builtin **takes the parent down with it** — the parent dumped core. A
fork with `--max-old-space-size` dies alone and the parent keeps working.

**What this does not bound.** `--max-old-space-size` bounds V8's old
space. It bounds neither external nor native memory (typed-array backing
stores, Buffers), so it is not a total memory bound. A pattern that
allocates its way out through those is caught by the deadline, which is
a weaker guarantee. Say this plainly rather than implying the problem is
solved.

### Query density guard (#360)

`queryEvents` will not materialize a query it has not sampled first. The
old guard sampled the **head** of the range and extrapolated, which left
two measured holes:

```
s("bd*200000")   -> refused correctly
s("~ bd*200000") -> OUT OF HEAP.  One leading rest, and the probe saw
                    nothing, projected nothing, refused nothing.
```

`EventDensityProbe` samples 8 windows spread across the range at 4 span
scales, growing until a window holds a real sample. Four rules matter,
and each one was a bug first:

- **A projection needs a sample.** `s("bd").slow(64)` returns one hap at
  any span, because events legitimately begin at t=0; extrapolating from
  it projects 10^12 events and refuses an ordinary pattern. So a window
  must hold 16 *distinct onset times* before its density is believed —
  distinct, because a stack of N layers starting together is one moment
  observed N times.
- **Windows must not align with the cycle.** Evenly spaced windows over a
  16-cycle range all start on whole cycles — the same phase, eight times
  — so `s("~ bd*200000")` was refused over `0..1` and exhausted the heap
  over `0..4`. Each window is slid within its slice by an irrational
  fraction of it.
- **The near-cap verdict is an average, not a maximum.** A window at t=0
  of `s("bd*40000")` sees twice the cycle's average density and projects
  80,000 against a 50,000 cap — a false refusal. Only the
  wildly-over-the-cap shortcut acts on a single window.
- **Refusing at the cap is wrong.** The caller counts materialized haps
  and enforces the cap exactly, for free. The probe only refuses what is
  too big to *materialize*.

**Resolution, not a guarantee.** A dense region narrower than 1/8 of the
range and sitting between two windows is not seen; nor is one so dense
that growing a window into it from an adjacent rest is itself fatal.
Since #307 both degrade to an error envelope and a respawned child rather
than a dead server. `verify-sandbox.ts` deliberately uses such a pattern
to prove the containment still holds.

Cost: `query_pattern_events` went from ~1ms to ~28ms warm (up to 32
`queryArc` calls where there was one). Gated in `latency.benchmark.ts`.

Note `verify-sandbox.ts` runs the engine **in-process with no heap cap**,
so it cannot see a probe that OOMs only under the child's limit. Check
new density cases through `IsolatedStrudelEngine` too.

### Current Limitations
- Multi-session is supported (#108, v3.0.0): each `session_id` gets its own browser page, undo/redo/history, and audio capture. Max 5 concurrent sessions, 30-min idle eviction. Browser process is still shared across sessions (one Chromium, multiple contexts).
- **Tempo detection measures the music now, and this bullet used to say
  otherwise long after it stopped being true.** It described a
  once-per-call spectrum sample and a fixed `ONSET_THRESHOLD = 0.3` that
  only a silence-to-full-scale transition could fire. #322 replaced the
  collection with a continuous 20ms buffer in the page, #350 replaced the
  threshold with an adaptive MAD decision, and #352 fixed the analysis.
  What holds today:
  - Onsets carry their flux magnitude, so a kick outweighs a hi-hat in
    the autocorrelation. Without it a 174 BPM pattern with 8th hats read
    115.
  - Onset times are quantized to the 20ms sampling step, and most tempos
    do not divide into it — a 345ms beat lands alternately on 340 and
    360, and an impulse train has no lag matching both. Each onset is
    spread over a kernel one sampling step wide to absorb that. Before
    it, only tempos whose period was a whole number of samples read
    correctly (120 from 500ms, 100 from 600ms) and the rest did not.
  - One transient produces one onset. A drum hit stays above the
    threshold for several consecutive frames, and every frame used to
    become its own onset — measured against real playback, the median
    inter-onset interval was 20ms, exactly one sampling step, for dnb,
    techno and house alike (#366).
  - A reading with no pulse behind it reports `bpm: 0`, not the tempo
    prior's centre. The correlation always has a highest lag; when the
    onsets carry no periodicity that lag is whatever the 120 BPM prior
    likes, and it used to be returned looking exactly like a
    measurement.
  - Verified on synthetic flux across ten tempo/subdivision combinations
    (`TempoSamplingJitter.test.ts`), all within 5%. That is arithmetic,
    not audio: it says nothing about how a real mix's spectrum behaves,
    and the browser band stays wide (40-200) until measured against real
    playback.
  - Onset history is bounded by AGE (12s) and dropped entirely across a
    silence longer than a bar, and the controller clears it on
    `writePattern` and `stop`. A count bound alone let one reading mix
    two patterns: playing dnb then house, the first house reading came
    back 174 (#366).
  - **Measured against real playback**, writing once and then polling —
    which is how an agent listens, and not the same as rewriting the
    pattern before every read:

    | example | declared | run A | run B |
    |---|---|---|---|
    | House (classic) | 125 | 125, 125, 125, 125 | 125, 125, 125, 125 |
    | Driving techno | 130 | 130, 130, 130, 130 | 130, 130, 130, 130 |
    | Modern trap | 140 | 140, 140, 140, 140 | 140, 140, 140, 140 |
    | Drum & bass (classic) | 174 | 174, 174, 174, 174 | 87, 174, 174, 174 |
    | Amen break | 165 | 164, 83, 83, 83 | 164, 83, 83, 82 |
    | Ambient pad / Jazz | 70 / 120 | no tempo | no tempo |

    Two runs, always — a single run once read clean across the board and
    I wrote "stable everywhere" on the strength of it, which a second run
    contradicted.

    Four of five percussive examples read exactly, every poll. Drum and
    bass reached this only with octave-family scoring (#370): before it,
    the 120-centred prior overturned a correlation that already favoured
    174, and 115 was unrecoverable because its double (230) sits outside
    the 40-200 window so the half-time walk had nowhere to go.

    The amen break flips between octave families run to run on identical
    audio — six runs gave 83, 83, 164, 82, 167, 83. Measured, the two
    candidates score within a few percent of each other, so ordinary
    variation in which transients are detected swaps the winner:

    | example | winner vs runner-up | vs best out-of-family rival |
    |---|---|---|
    | House 125 | 35.9% | 52.8% |
    | Techno 130 | 30.8% | 51.3% |
    | Trap 140 | 20.9% | 23.7% |
    | Amen break | 2.3% | 13.8% |
    | Drum & bass 174 | 4.1% | 10.2% |

    **Do not add a margin threshold to suppress the near ties.** Drum and
    bass sits at 4.1% and reads 174 correctly on six of six runs; any cut
    that catches the amen break catches it too. A consensus vote chose to
    refuse on near ties 4-to-1, on the stated premise that the clean
    examples win by margins that are "not close" — the table above is
    what that premise looks like when measured, and it is false (#374).

    Reporting `bpm: 0` here would also be its own false claim: the amen
    break HAS a strong pulse, and what is ambiguous is which metrical
    level to call the beat. Half-time is a legitimate hearing of a
    breakbeat. `alternatives` carries the other octave and confidence is
    0.21 against techno's 0.93, so the uncertainty is already reported.

    The two non-percussive examples report no tempo rather than guessing,
    which is the right answer for a pad with a three-second attack.
- Key detection uses Krumhansl-Schmuckler with Pearson correlation and no
  mode boosts (#320). It recovers all 24 canonical profiles exactly, but
  it depends on chroma resolution: at the shipped `fft_size: 2048`
  (21.5 Hz/bin) pitch classes below ~170 Hz are unreliable, and at 1024
  (43 Hz/bin) anything below ~500 Hz is. Raise `fft_size` to 4096 for
  bass-register work (#321).
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
├── StrudelController.ts        # Browser automation (~970 lines)
├── AudioAnalyzer.ts            # Audio analysis (~890 lines)
├── PatternStore.ts             # On-disk JSON persistence
├── server/
│   ├── server.ts                    # MCP dispatcher (~680 lines, post-#104)
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
│   ├── StrudelEngineHelpers.ts # Pure helpers (#107, direct-tested)
│   ├── StyleRegistry.ts        # Style aliases, per-layer resolution, tempos
│   ├── MIDIExportService.ts    # Strudel -> MIDI export
│   ├── MIDIImportService.ts    # MIDI -> Strudel import (#203)
│   ├── AudioExportService.ts   # Record live audio to WAV/WebM (#223)
│   ├── PatternSandbox.ts       # AST allowlist + vm for local execution (#229)
│   ├── EventDensityProbe.ts    # Refuses a query before it allocates (#360)
│   ├── LocalPatternEngine.ts   # The contract the local tools depend on (#307)
│   ├── IsolatedStrudelEngine.ts # LocalPatternEngine over a forked child (#307)
│   ├── IsolatedEngineRunner.ts # Persistent fork: heap cap + deadline (#307)
│   ├── engineChild.ts          # Child entrypoint; the only isolated importer
│   ├── engineChildPath.ts      # Child path (import.meta — see the file)
│   ├── BrowserOnlyFunctions.ts # Functions the local engine can't provide (#232)
│   └── ai/                     # Provider-agnostic AI transport (#252)
│       ├── AiTransport.ts      # The seam: (prompt) => Promise<string>
│       ├── CliTransport.ts     # Drives claude / agy / codex
│       └── AudioMeasurements.ts # Describes audio numerically for any model
├── types/
│   └── AudioAnalysis.ts        # Analysis result + config types
├── utils/
│   ├── Logger.ts               # Logging (22 lines)
│   ├── PatternValidator.ts     # Validation (286 lines)
│   ├── ErrorRecovery.ts        # Error handling (267 lines; only handlePatternWrite is reached from live code)
│   ├── PerformanceMonitor.ts   # Monitoring (156 lines)
│   ├── InputValidator.ts       # Input validation (349 lines)
│   ├── SafePath.ts             # Filename confinement for exports (#224)
│   └── ServerConfig.ts         # config.json parsing + validation (#227)
└── __tests__/                  # Jest tests
```

## Testing Strategy
- **Unit Tests**: MusicTheory (100% statements, 75% branches), PatternGenerator (78.4% statements) — the 100% target below is a target, not the current state
- **Integration Tests**: StrudelController, PatternStore (77-85% coverage)
- **Mock Infrastructure**: MockPlaywright, TestFixtures
- **Coverage Target**: 80% overall, 100% for services. Current: 88.02% overall; PatternGenerator sits at 78.4% and StrudelEngine at 0% (its tests run against a mock because @strudel/core is ESM and Jest is not configured for it — `npm run test:sandbox` covers the real engine)

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
1. Run `npm run lint` - **CI blocks on this and nothing else here catches it.**
   `tsc` does not flag unused imports or variables; eslint does, as errors.
   This step was missing from the list until a PR failed CI on exactly
   that, having passed build, test and tsc locally.
2. Run `npm run build` - Verify TypeScript compilation
3. Run `npm test` - Ensure tests pass
4. Run `npm run validate` - Test MCP protocol
5. Update README.md if adding tools
6. Add JSDoc to new public methods

`npm run lint` reports ~198 pre-existing `no-explicit-any` **warnings**;
those do not fail CI. Only the error count matters — check it is zero:

```bash
npm run lint 2>&1 | grep -c ' error '
```

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
- `ErrorRecovery` exists for retries, but only `handlePatternWrite` is wired up; `executeWithRetry`, the circuit breaker and the network-retry helper have no production callers
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
// Always sanitize filenames (PatternStore.ts:183)
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
- Block unnecessary resources (images, fonts) in Playwright (StrudelController.ts:109-115)
- Use `Promise.all` for parallel I/O (PatternStore.ts:135)
- Direct CodeMirror API > keyboard simulation (80% faster)

### 6. Testing Standards

**Test Coverage Requirements:**
- Overall: 80% statement coverage minimum
- Services (MusicTheory, PatternGenerator): 100% coverage target — PatternGenerator is currently 78.4%
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
