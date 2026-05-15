# Architecture

How live-coding-music-mcp is put together. For the user-facing overview see the [README](README.md); for development workflow see [DEVELOPMENT.md](DEVELOPMENT.md).

## System Overview

live-coding-music-mcp uses a modular architecture. Components:

```
┌─────────────────────────────────────────────────────────────┐
│                       Claude AI                              │
│                  (MCP Client)                                │
└───────────────────────┬─────────────────────────────────────┘
                        │ MCP Protocol (stdio)
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              StrudelMCPServer                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Tool Request Handler                                  │ │
│  │  - Validates inputs                                    │ │
│  │  - Routes to appropriate service                       │ │
│  │  - Wraps responses in result envelope                  │ │
│  └────────────────────────────────────────────────────────┘ │
└───────┬────────────┬────────────┬───────────┬──────────────┘
        │            │            │           │
   ┌────▼─────┐ ┌───▼────┐  ┌────▼────┐  ┌──▼──────┐
   │ Strudel  │ │ Music  │  │ Pattern │  │ Pattern │
   │Controller│ │ Theory │  │Generator│  │  Store  │
   └────┬─────┘ └────────┘  └─────────┘  └─────────┘
        │
   ┌────▼────────────────────────────┐
   │   Playwright Browser            │
   │  ┌──────────────────────────┐   │
   │  │   Strudel.cc Website     │   │
   │  │  ┌────────────────────┐  │   │
   │  │  │  CodeMirror Editor │  │   │
   │  │  └────────────────────┘  │   │
   │  │  ┌────────────────────┐  │   │
   │  │  │  Audio Context     │  │   │
   │  │  │  + Web Audio API   │  │   │
   │  │  └────────┬───────────┘  │   │
   │  └───────────┼──────────────┘   │
   └──────────────┼──────────────────┘
                  │
          ┌───────▼────────┐
          │ Audio Analyzer │
          │  - FFT Analysis│
          │  - Frequency   │
          │  - Spectral    │
          └────────────────┘
```

## Core Components

### 1. StrudelMCPServer (`src/server/server.ts`, ~510 lines)

Thin MCP dispatcher that:
- Aggregates 26 tool definitions from the per-domain modules in `src/server/tools/`
- Routes `tools/call` requests to the right module's `execute()`
- Wraps every response in the discriminated result envelope (`{ ok, errorCategory, isRetryable, ... }`)
- Tracks initialization, per-session history bundles, per-session audio capture services
- Advertises and serves MCP resources (`strudel://examples`, etc.)
- Lazy-initializes the default browser controller on first browser-touching call

Notable state:
- Pattern caching before browser init
- Per-session undo/redo stacks (#179)
- Per-session pattern history (max 100 entries)
- Per-session AudioCaptureService instances (#180)

### 2. StrudelController (`src/StrudelController.ts`, ~800 lines)

Browser automation layer using Playwright:
- **Browser Management**: Chromium instance lifecycle
- **Editor Control**: CodeMirror manipulation via direct API access (faster than keyboard simulation)
- **Playback Control**: Keyboard shortcuts for play/stop
- **Performance Optimizations**:
  - Editor content caching (100ms TTL)
  - Direct CodeMirror API access (`editor.__view.dispatch(...)`)
  - Resource blocking (images, fonts) on page load
  - Fast DOM content loading

```typescript
// Example: optimized pattern writing
async writePattern(pattern: string) {
  await this.page.evaluate((newPattern) => {
    const editor = document.querySelector('.cm-content');
    const view = editor.__view;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: newPattern }
    });
  }, pattern);
}
```

### 3. AudioAnalyzer (`src/AudioAnalyzer.ts`, ~800 lines)

Real-time audio analysis via Web Audio API injection:
- **FFT Analysis**: 1024-point FFT for spectral data
- **Frequency Bands**: Bass, low-mid, mid, high-mid, treble
- **Analysis Caching**: 50ms TTL
- **Features Extracted**:
  - Average / peak amplitude
  - Peak frequency
  - Spectral centroid
  - Playing-state detection
  - Frequency distribution / brightness classification
- **Tempo detection**: Onset-based, 40-200 BPM range
- **Key detection**: Krumhansl-Schmuckler over chroma features

### 4. MusicTheory (`src/services/MusicTheory.ts`)

Music-theory engine providing:
- **15+ Scales**: Major, minor, modes, pentatonic, blues, whole-tone, harmonic/melodic minor, chromatic
- **Chord Progressions**: Pop, jazz, blues, rock, folk, EDM templates
- **Euclidean Rhythms**: Mathematical rhythm generation
- **Arpeggio Generation**: Up, down, random patterns
- **Note Transposition**: Semitone-based pitch shifting

### 5. PatternGenerator (`src/services/PatternGenerator.ts`, ~680 lines)

Template-based pattern generation (not AI):
- **Genre Templates**: techno, house, dnb, ambient, trap, jungle, jazz, experimental
- **Drum Patterns**: complexity levels per genre
- **Basslines**: multiple styles per genre
- **Melody Generation**: scale-based with musical intervals
- **Variations**: subtle, moderate, extreme, glitch, evolving
- **Fills**: 1-4 bar drum fills

Example:
```typescript
generateCompletePattern('techno', 'C', 130)
// → multi-layer pattern with drums, bass, chords, melody
```

### 6. PatternStore (`src/PatternStore.ts`)

Persistent pattern storage:
- JSON-per-pattern on disk
- Metadata: name, tags, timestamp, audio features
- Tag filtering
- Sorted retrieval (most recent first)
- Path-traversal protection in `sanitizeFilename()`

## Directory Structure

```
live-coding-music-mcp/
├── src/
│   ├── server/
│   │   ├── server.ts                    # MCP dispatcher (~510 lines)
│   │   ├── resources.ts                 # MCP resources (#131)
│   │   └── tools/
│   │       ├── ai.ts, analysis.ts, capture.ts, compose.ts,
│   │       ├── diagnostics.ts, editor.ts, generate.ts, history.ts,
│   │       ├── playback.ts, session.ts, storage.ts, transform.ts,
│   │       └── types.ts                 # ToolContext, Envelope, helpers
│   ├── services/
│   │   ├── MusicTheory.ts                # Scale/chord/euclidean helpers
│   │   ├── PatternGenerator.ts           # Template-based generation
│   │   ├── SessionManager.ts             # Multi-session lifecycle (#108)
│   │   ├── AudioCaptureService.ts        # Audio recording
│   │   ├── MIDIExportService.ts          # MIDI export
│   │   ├── GeminiService.ts              # Gemini API client (ai_assist)
│   │   ├── StrudelEngine.ts              # @strudel/* wrapper
│   │   └── StrudelEngineHelpers.ts       # Pure helpers (#107)
│   ├── utils/
│   │   ├── Logger.ts
│   │   ├── PatternValidator.ts           # Syntax + safety checks
│   │   ├── ErrorRecovery.ts              # Retry / backoff
│   │   ├── PerformanceMonitor.ts
│   │   └── InputValidator.ts             # Input bound checks
│   ├── StrudelController.ts              # Browser automation (~800 lines)
│   ├── AudioAnalyzer.ts                  # Audio analysis (~800 lines)
│   ├── PatternStore.ts                   # On-disk pattern persistence
│   └── index.ts                          # Entry point
├── src/__tests__/                        # Jest suites (unit + integration + browser)
├── patterns/
│   ├── examples/                         # 18 bundled example patterns
│   └── *.json                            # Saved patterns at runtime
├── scripts/
│   ├── generate-tool-docs.ts             # README tool-table generator
│   └── generate-changelog.ts
├── config.json                           # Local config (gitignored)
├── package.json
└── tsconfig.json
```

## Data Flow

1. **Tool Invocation**
   ```
   Claude → MCP Protocol (stdio) → StrudelMCPServer
   ```

2. **Pattern Generation** (no browser needed)
   ```
   Server → PatternGenerator → MusicTheory → Pattern String
   ```

3. **Pattern Execution** (with browser)
   ```
   Server → StrudelController → Playwright → Strudel.cc
   ```

4. **Audio Analysis**
   ```
   Strudel.cc → Web Audio API → AudioAnalyzer (FFT) → Features
   ```

## Performance Characteristics

See the [Performance section in the README](README.md#performance) for the measured latency table.

## Optimization Strategies

1. **Caching**
   - Editor content: 100ms TTL
   - Audio analysis: 50ms TTL
   - Generated patterns: until browser init

2. **Resource Blocking**
   - Images, fonts, media blocked
   - Only essential JavaScript/CSS loads

3. **Direct API Access**
   - CodeMirror view manipulation via `editor.__view`
   - Keyboard shortcuts over button clicks where possible

4. **Lazy Loading**
   - Browser starts only on first browser-touching tool call
   - Services initialized on-demand
