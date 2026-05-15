# live-coding-music-mcp

> 🎵 MCP server for AI-assisted live-coding music via [strudel.cc](https://strudel.cc/)
>
> **Unofficial fan project.** Not affiliated with, or endorsed by, the [Strudel project](https://codeberg.org/uzu/strudel). This adapter exists to make live-coding music accessible to beginners who want to try pattern-based music without learning the whole ecosystem first.
>
> **Status:** Beta | 86% statement coverage | Published to npm | Actively developed

<a href="https://glama.ai/mcp/servers/@williamzujkowski/live-coding-music-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@williamzujkowski/live-coding-music-mcp/badge" alt="live-coding-music-mcp server" />
</a>

[![CI](https://github.com/williamzujkowski/live-coding-music-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/williamzujkowski/live-coding-music-mcp/actions)
[![npm version](https://img.shields.io/npm/v/@williamzujkowski/live-coding-music-mcp.svg)](https://www.npmjs.com/package/@williamzujkowski/live-coding-music-mcp)
[![Nerq Trust](https://nerq.ai/badge/live-coding-music-mcp)](https://nerq.ai/kya/live-coding-music-mcp)
[![Tools](https://img.shields.io/badge/tools-26-green.svg)]()
[![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)

A Model Context Protocol (MCP) server that drives [Strudel.cc](https://strudel.cc/) from Claude for AI-assisted live-coding music, pattern generation, and algorithmic composition.

**Current State: Beta.** The core workflow (init → compose → playback → analyze) works reliably with real audio output. 1709 tests pass, 86.32% statement coverage / 75.93% branch coverage. CI is hardened with OpenSSF Scorecard, SHA-pinned actions, CODEOWNERS, Dependabot, and lint as a blocking gate.

**What "Beta" means here:**
- Tool schemas are stable within minor versions; breaking changes require a major bump
- Multi-session is supported as of v3.0.0 ([#108](https://github.com/williamzujkowski/live-coding-music-mcp/issues/108)) — named sessions get isolated browser, history, and audio-capture state
- Upstream `@strudel/*` dependencies pinned to known-good versions; Dependabot bumps gated on CI
- Expect hands-on iteration for non-standard patterns — report rough edges, they get fixed

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Quick Reference](#quick-reference)
- [Available Tools](#available-tools)
- [Usage Examples](#usage-examples)
- [Architecture](#architecture)
- [Advanced Usage](#advanced-usage)
- [Configuration](#configuration)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Contributing](#contributing)

## Features

### 🎹 Music control
- **26 MCP tools** covering pattern editing, playback, audio analysis, generation, history, sessions, and Gemini-backed assists. Each tool is enum-parameterized to keep the protocol surface small: `pattern_store({ action })`, `edit_pattern({ mode })`, `transform({ op })`, `analyze({ include })`, `history({ action })`, `playback({ action })`, `effect({ action })`, `shape({ dimension })`, `audio_capture({ action })`, `browser_window({ action })`, `generate_part({ role })`, `generate_rhythm({ type })`, `music_theory({ query })`, `session({ action })`, `ai_assist({ task })`, ... The 58 legacy single-verb aliases that forwarded to these were removed in v4.0.0 ([#178](https://github.com/williamzujkowski/live-coding-music-mcp/issues/178)).
- **4 MCP resources** for catalog browsing without burning tool calls: `strudel://examples`, `strudel://patterns`, `strudel://styles`, `strudel://docs/tools`.
- **Real browser automation** of Strudel.cc through Playwright.
- **Multi-session support** — every browser-touching tool accepts an optional `session_id`; sessions have isolated browser pages, undo/redo/history stacks, and audio-capture services.
- **Audio analysis** via Web Audio API (FFT spectrum, tempo detection, key detection, rhythm complexity).
- **Template-based pattern generation** across 8 genres (techno, house, dnb, ambient, trap, jungle, jazz, experimental); optional Gemini-backed `ai_assist` for feedback, suggestions, and jamming.
- **Music theory helpers**: 15+ scales, 8+ chord progression styles, euclidean and polyrhythm generation.
- **Pattern persistence**: JSON-backed save/load with tags + the in-memory edit history (undo/redo/restore/compare).
- **Result envelope** on every `tools/call`: clients branch on `{ ok, errorCategory, isRetryable }` instead of parsing free-text.

### 🔧 Testing & CI status
- **1709 passing tests** across unit, integration, and example-validation suites; 20 skipped (browser, gated by Playwright).
- **86.32% statement coverage / 75.93% branch coverage**.
- **Lint blocking in CI**: 0 errors, ~163 warnings (mostly `any` in test mocks).
- **OIDC trusted publishing** to npm with SLSA build provenance attestation on every release.

**Not Production-Ready:** This is experimental software under active development. Use for exploration and experimentation. Expect breaking changes, bugs, and incomplete features. See [the Contributing section](#contributing) to help improve it.

### 🎼 Example patterns

18 example patterns ship in [`patterns/examples/`](patterns/examples/), grouped by genre:

- **Techno**: hard-techno, minimal-techno
- **House**: deep-house, tech-house
- **Drum & Bass**: liquid-dnb, neurofunk
- **Ambient**: dark-ambient, drone
- **Trap**: modern-trap, cloud-trap
- **Jungle**: classic-jungle, ragga-jungle
- **Jazz**: bebop, modal-jazz
- **Longform** (multi-minute pieces): dark-ambient-journey, driving-techno, liquid-dnb-roller, nu-jazz-session

Each example is a JSON file with pattern code, BPM, key, and a description. See [`patterns/examples/README.md`](patterns/examples/README.md) for details. Agents can also list these via the `strudel://examples` MCP resource without making any tool calls.

## Migrating from `@williamzujkowski/strudel-mcp-server`

This project was renamed from `@williamzujkowski/strudel-mcp-server` to `@williamzujkowski/live-coding-music-mcp` to make the unofficial fan-project status unambiguous (see [#97](https://github.com/williamzujkowski/live-coding-music-mcp/issues/97)). The old package is deprecated on npm.

**If you were using the old package:**

```bash
# Remove old
npm uninstall -g @williamzujkowski/strudel-mcp-server

# Install new
npm install -g @williamzujkowski/live-coding-music-mcp
```

**Update your MCP client config.** The `bin` name changed from `strudel-mcp` to `live-coding-music-mcp`:

```jsonc
// BEFORE
{
  "mcpServers": {
    "strudel": { "command": "strudel-mcp" }
  }
}

// AFTER
{
  "mcpServers": {
    "live-coding-music": { "command": "live-coding-music-mcp" }
  }
}
```

The MCP server's internal identity string also changed from `strudel-mcp-enhanced` to `live-coding-music-mcp`. If you have a client that keys on that string (logs, allowlists, permission policies), update it accordingly.

All tool names and schemas are unchanged.

## Installation

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 22.x+ | LTS required |
| npm | 10+ | Comes with Node.js |
| Chromium | Latest | Auto-installed by Playwright |
| Audio output | Any | Required for playback (speakers/headphones) |

**Optional:** Docker for containerized deployment.

### From npm
```bash
npm install -g @williamzujkowski/live-coding-music-mcp

# Install browser (required once)
npx playwright install chromium
```

### From Source
```bash
# Clone repository
git clone https://github.com/williamzujkowski/live-coding-music-mcp.git
cd live-coding-music-mcp

# Install dependencies
npm install

# Install Chromium for browser automation
npx playwright install chromium

# Build the project
npm run build
```

## Quick Start

Get from install to your first generated pattern in under two minutes.

### 1. Install

```bash
npm install -g @williamzujkowski/live-coding-music-mcp
npx playwright install chromium   # one-time
```

Building from source instead? See [Installation → From Source](#from-source).

### 2. Configure your MCP client

#### Claude Desktop

Edit your Claude Desktop config file:

| OS | Config path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Add the server:

```json
{
  "mcpServers": {
    "live-coding-music": {
      "command": "live-coding-music-mcp"
    }
  }
}
```

Restart Claude Desktop. The server appears under the 🔌 plug icon.

#### Claude Code (CLI)

```bash
# If installed globally
claude mcp add strudel live-coding-music-mcp

# If built from source
claude mcp add strudel node /path/to/live-coding-music-mcp/dist/index.js
```

### 3. Verify the server responds

```bash
# From a global install
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | live-coding-music-mcp

# From source
npm run validate
```

You should see a JSON response listing **26 tools**. If you see fewer, the build is out of date — run `npm run build`.

### 4. Make your first sound

In Claude, ask:

> Initialize Strudel and compose a techno beat.

**What you'll see:** A Chromium window opens (visibly — this is the live editor, not a hidden process) and lands on strudel.cc. Claude calls `init`, then `compose({ style: "techno" })`. A 4-on-the-floor pattern appears in the CodeMirror editor and starts playing through your speakers.

Prefer headless mode (no browser window)? Set `"headless": true` in `config.json` before the first `init` call — see [Configuration](#configuration). Note that audio analysis (tempo / key detection) is more reliable in headed mode; headless audio sampling is best-effort.

### 5. Where to go next

- [Quick Reference](#quick-reference) below: tool cheat sheet for common operations.
- [Usage Examples](#usage-examples): multi-step workflows (composition, audio analysis, AI-assisted jamming).
- [`patterns/examples/`](patterns/examples/): 18 ready-to-play patterns across 7 genres plus 4 longform pieces. Agents can browse them via the `strudel://examples` MCP resource without burning tool calls.

## Quick Reference

Common operations as one-line tool calls:

| Action | Tool call |
|---|---|
| Initialize browser | `init` |
| Create a techno beat in one shot | `compose({ style: "techno" })` |
| Play pattern | `playback({ action: "play" })` |
| Stop playback | `playback({ action: "stop" })` |
| Get current pattern | `get_pattern` |
| Analyze audio (all features) | `analyze({ include: ["all"] })` |
| Detect tempo only | `analyze({ include: ["tempo"] })` |
| Save pattern | `pattern_store({ action: "save", name: "my-pattern" })` |
| Undo last edit | `history({ action: "undo" })` |
| Edit current pattern | `edit_pattern({ mode: "write", pattern: "..." })` |
| Create an isolated session | `session({ action: "create", session_id: "live-1" })` |

The legacy single-verb tools (`play`, `stop`, `save`, `undo`, `write`, `generate_pattern`, ...) were deprecated aliases during the `3.0.x` line and were removed in v4.0.0 ([#178](https://github.com/williamzujkowski/live-coding-music-mcp/issues/178)). Use the consolidated tools above.

**One-shot workflow:**
```
compose with style: "dnb", key: "Am", tempo: 174, auto_play: true
```

## Available Tools

<!-- TOOLS:START -->

**26 tools** across 14 categories:

<details><summary><strong>Setup</strong> (1)</summary>

| Tool | Description |
|------|-------------|
| `init` | Initialize Strudel in browser |

</details>

<details><summary><strong>Pattern Editing</strong> (2)</summary>

| Tool | Description |
|------|-------------|
| `edit_pattern` | Mutate the current session pattern.  |
| `get_pattern` | Get current pattern code |

</details>

<details><summary><strong>Playback</strong> (2)</summary>

| Tool | Description |
|------|-------------|
| `playback` | Control transport on the current session.  |
| `set_tempo` | Set BPM |

</details>

<details><summary><strong>Storage</strong> (1)</summary>

| Tool | Description |
|------|-------------|
| `pattern_store` | Persist patterns to disk and read them back.  |

</details>

<details><summary><strong>History</strong> (1)</summary>

| Tool | Description |
|------|-------------|
| `history` | Navigate or inspect the pattern edit history.  |

</details>

<details><summary><strong>Generation</strong> (3)</summary>

| Tool | Description |
|------|-------------|
| `compose` | Generate, write, and play a complete pattern in one step. Auto-initializes default browser if needed. |
| `generate_part` | Generate a single instrumental layer and append it to the current session pattern.  |
| `generate_rhythm` | Generate a rhythmic pattern and append it to the current session.  |

</details>

<details><summary><strong>Music Theory</strong> (1)</summary>

| Tool | Description |
|------|-------------|
| `music_theory` | Music-theory queries.  |

</details>

<details><summary><strong>Transform</strong> (3)</summary>

| Tool | Description |
|------|-------------|
| `transform` | Apply a single transform op to the current session pattern.  |
| `effect` | Add or remove a Strudel effect on the current session pattern.  |
| `shape` | Shape the current pattern along one of three high-level dimensions.  |

</details>

<details><summary><strong>AI</strong> (1)</summary>

| Tool | Description |
|------|-------------|
| `ai_assist` | Gemini-backed pattern assistance.  |

</details>

<details><summary><strong>Analysis</strong> (6)</summary>

| Tool | Description |
|------|-------------|
| `analyze` | Audio analysis on the currently-playing pattern.  |
| `validate_pattern_runtime` | Validate pattern with runtime error checking (monitors Strudel console for errors) |
| `validate_pattern_local` | Validate pattern syntax against the in-process StrudelEngine (no browser required) |
| `analyze_pattern_local` | Static analysis (events/cycle, complexity, optional BPM) without browser playback |
| `query_pattern_events` | Enumerate events the pattern would emit between two cycle indices (max 16 cycles) |
| `transpile_pattern` | Transpile pattern source via StrudelEngine; returns transpiled code or syntax error |

</details>

<details><summary><strong>Session</strong> (1)</summary>

| Tool | Description |
|------|-------------|
| `session` | Manage isolated Strudel browser sessions (multi-session, #108).  |

</details>

<details><summary><strong>Export</strong> (2)</summary>

| Tool | Description |
|------|-------------|
| `export_midi` | Export current pattern to MIDI file. Parses note(), n(), and chord() functions. |
| `browser_window` | Interact with the visible Strudel browser window.  |

</details>

<details><summary><strong>Audio</strong> (1)</summary>

| Tool | Description |
|------|-------------|
| `audio_capture` | Record audio output from the live Strudel session.  |

</details>

<details><summary><strong>Debug</strong> (1)</summary>

| Tool | Description |
|------|-------------|
| `diagnostics` | Inspect server and browser state.  |

</details>

_Auto-generated from source. 26 tools registered._

<!-- TOOLS:END -->

## Usage Examples

### Basic Pattern Creation

**Create a Simple Beat**
```
You: Initialize Strudel and create a simple techno beat

Claude: [Initializes browser]
        [Generates and writes pattern]
        [Starts playback]

Pattern created:
setcpm(130)
stack(
  s("bd*4"),
  s("~ cp ~ cp"),
  s("hh*8").gain(0.4)
).gain(0.8)
```

**Generate a Bassline**
```
You: Add a techno bassline in C

Claude: [Generates bassline]
        [Appends to current pattern]

Added: note("c2 c2 c2 c2").s("sawtooth").cutoff(800)
```

### Advanced Music Generation

**Jazz Composition**
```
You: Create a jazz progression in F major with a walking bass

Claude: Generated progression: "Gm7" "C7" "Fmaj7"

Pattern:
stack(
  note("Gm7" "C7" "Fmaj7").struct("1 ~ ~ ~").s("piano"),
  note("g2 c2 f2").s("sine").gain(0.7)
)
```

**Drum & Bass Track**
```
You: Generate a complete drum & bass track at 174 BPM

Claude: [Creates multi-layer pattern with drums, bass, and pads]

// dnb pattern in C at 174 BPM
setcpm(174)
stack(
  // Drums
  s("bd ~ ~ [bd bd] ~ ~ bd ~, ~ ~ cp ~ ~ cp ~ ~").fast(2),

  // Bass
  note("c1 ~ ~ c2 ~ c1 ~ ~").s("square").cutoff(400),

  // Pads (atmospheric)
  note("c3 eb3 g3 bb3").s("sawtooth")
    .attack(2).release(4).room(0.8).gain(0.6)
)
```

### Real-Time Manipulation

**Live Audio Analysis**
```
You: Analyze what's playing and show me the frequency breakdown

Claude: Audio Analysis Results:
{
  "connected": true,
  "features": {
    "average": 78.5,
    "peak": 180,
    "peakFrequency": 120,
    "bass": 145,
    "mid": 82,
    "treble": 45,
    "isPlaying": true,
    "brightness": "balanced"
  }
}

Strong bass presence detected - typical for techno/house patterns.
```

**Pattern Variations**
```
You: Create a glitchy variation of the current pattern

Claude: [Applies glitch transformation]

Added: .sometimes(x => x.chop(8).rev).rarely(x => x.speed(-1))
```

### Multi-Track Composition

**Layered Ambient Track**
```
You: Create an ambient soundscape with multiple layers

Claude: [Generates complex multi-layer pattern]

setcpm(90)
stack(
  // Deep bass drone
  note("c1").s("sine").attack(4).release(8).gain(0.5),

  // Texture pad
  note("c3 eb3 g3").s("sawtooth")
    .attack(2).release(6).room(0.9).gain(0.4),

  // Sparse percussion
  s("bd ~ ~ ~, ~ ~ ~ hh:8").room(0.9).gain(0.3),

  // Melodic sparkles
  note("c5 g5 eb5 bb5").struct("~ 1 ~ 1 ~ ~ 1 ~")
    .s("triangle").delay(0.5).room(0.8).gain(0.3)
)
```

### Session Management

**Save and Load Patterns**
```
You: Save this pattern as "techno-groove-1" with tags "techno" and "experimental"

Claude: Pattern saved as "techno-groove-1"

---

You: List all my techno patterns

Claude: Saved patterns with tag "techno":
• techno-groove-1 [techno, experimental] - 2025-10-23T19:30:00.000Z
• acid-bassline [techno, acid] - 2025-10-23T18:15:00.000Z

---

You: Load "acid-bassline"

Claude: Loaded pattern "acid-bassline"
[Pattern written to editor]
```

### Music Theory Applications

**Generate Euclidean Rhythms**
```
You: Create a 5/8 euclidean rhythm with kick drum

Claude: Generated Euclidean rhythm (5/8)

Pattern: s("bd").struct("1 ~ 1 ~ 1 1 ~ 1")
```

**Complex Polyrhythms**
```
You: Generate a polyrhythm with kick (4/16), snare (7/16), and hi-hat (3/16)

Claude: Generated polyrhythm

stack(
  s("bd").euclid(4, 16),
  s("cp").euclid(7, 16),
  s("hh").euclid(3, 16)
)
```

### Integration with LLM Agents

**AI-Assisted Composition**
```
You: Analyze the mood of my current pattern and suggest complementary elements

Claude: [Analyzes pattern structure and audio features]

Your pattern has:
- Energetic rhythm (130 BPM)
- Strong bass presence
- Minimal melodic content

Suggestions:
1. Add arpeggiated synth for movement
2. Include occasional breaks/fills
3. Layer atmospheric pad for depth

Would you like me to add any of these?

You: Add an arpeggiated synth in C minor

Claude: [Generates and adds]

note("c4 eb4 g4 bb4 c5").struct("1 1 1 1 1 1 1 1")
  .s("triangle").delay(0.25).room(0.3).gain(0.5)
```

## Testing

Tools are exercised against real Strudel.cc interaction through the browser test suite; those are skipped in CI (require Playwright + audio) but run locally:

```bash
# Run integration tests
npm run test:integration

# Run browser tests
node tests/strudel-integration.js

# Run npm test to see current pass/fail/skip counts
```

## Configuration

### config.json
```json
{
  "headless": false,        // Set true for background operation
  "strudel_url": "https://strudel.cc/",
  "patterns_dir": "./patterns",
  "audio_analysis": {
    "fft_size": 1024,
    "smoothing": 0.8
  }
}
```

## Architecture

The server is a thin MCP dispatcher (`src/server/server.ts`, ~510 lines) over twelve per-domain tool modules (`src/server/tools/*.ts`), six services (MusicTheory, PatternGenerator, SessionManager, AudioCaptureService, GeminiService, MIDIExportService, StrudelEngine), two controllers (StrudelController for Playwright, AudioAnalyzer for Web Audio API), and a JSON-on-disk PatternStore. Browser automation hits the CodeMirror editor on strudel.cc directly via `editor.__view.dispatch(...)` rather than keyboard simulation — about 80% faster.

For the full breakdown — component diagram, per-component responsibilities, directory layout, data flow, and optimization strategies — see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## Pattern Examples

### Minimal Techno (Verified Working)
```javascript
setcpm(130)
stack(
  s("bd*4").gain(0.9),
  s("~ cp ~ cp").room(0.2),
  s("hh*16").gain(0.4).pan(sine.range(-0.5, 0.5)),
  note("c2 c2 eb2 c2").s("sawtooth").cutoff(800)
).swing(0.05)
```

### Drum & Bass (Verified Working)
```javascript
setcpm(174)
stack(
  s("bd ~ ~ [bd bd] ~ ~ bd ~, ~ ~ sn:3 ~ ~ sn:3 ~ ~").fast(2),
  s("hh*16").gain(0.5),
  note("e1 ~ ~ e2 ~ e1 ~ ~").s("sine:2").lpf(200)
)
```

### Generated Jazz Progression
```javascript
// Jazz ii-V-I in F
stack(
  note("Gm7" "C7" "Fmaj7").struct("1 ~ ~ ~").s("piano"),
  note("g2 c2 f2").s("sine").gain(0.7)
)
```

## Docker Support

```bash
# Build image
docker build -t live-coding-music-mcp .

# Run container
docker run -it --rm live-coding-music-mcp

# Or use docker-compose
docker-compose up
```

## Development

For development setup, scripts, debugging, adding new tools, and the release process, see **[DEVELOPMENT.md](DEVELOPMENT.md)**.

Quick links:
- [Setup](DEVELOPMENT.md#setup) — `git clone` to `npm test`
- [Adding new tools](DEVELOPMENT.md#adding-new-tools) — module pattern + envelope helpers
- [Release process](DEVELOPMENT.md#release-process) — `gh release create` triggers the publish workflow
- [Contributing](DEVELOPMENT.md#contributing) — commit conventions and PR flow

The [Configuration](#configuration) section above covers runtime config (`config.json`). [ARCHITECTURE.md](ARCHITECTURE.md) covers the system design.

## Performance

Measured against the current `StrudelController` cache + Strudel.cc on a developer machine:

| Operation | Latency |
|---|---|
| Browser initialization | 1.5–2 s (with resource blocking) |
| Pattern write | 50–80 ms (cached CodeMirror editor access) |
| Pattern read (cached) | 10–15 ms |
| Play / pause / stop | 100–150 ms |
| Audio analysis (single FFT) | 10–15 ms |
| Tempo detection | <100 ms (onset-based; degraded under headless audio) |
| Key detection | <100 ms (Krumhansl-Schmuckler) |
| Pattern generation | <100 ms (template-based) |
| Process resident memory | ~120–150 MB |

## Advanced Usage

### Custom Music Theory

**Create Custom Scales**
```typescript
// The MusicTheory service supports 15+ built-in scales
// You can request any combination:

You: Generate a lydian scale starting on D

Claude: D lydian scale: D, E, F#, G#, A, B, C#
```

**Complex Chord Progressions**
```typescript
You: Create a jazz ii-V-I progression in Bb with extended voicings

Claude: Generated jazz progression in Bb: "Cm7" "F7" "Bbmaj7"

Pattern:
note("Cm7" "F7" "Bbmaj7")
  .struct("1 ~ ~ ~")
  .s("sawtooth")
  .add(note("7"))  // Add 7th extensions
  .room(0.4)
```

### Advanced Rhythm Techniques

**Euclidean Patterns**
```
You: Create a complex polyrhythm using euclidean patterns:
     - Bass drum: 7 hits in 16 steps
     - Snare: 5 hits in 16 steps
     - Hi-hat: 11 hits in 16 steps

Claude: [Generates mathematically perfect polyrhythm]

stack(
  s("bd").euclid(7, 16),
  s("cp").euclid(5, 16),
  s("hh").euclid(11, 16)
)
```

**Generative Variations**
```
You: Create 3 variations of my current pattern: subtle, moderate, and glitchy

Claude: [Generates three variants]

Version 1 (subtle):
original.sometimes(x => x.fast(2))

Version 2 (moderate):
original.every(4, x => x.rev).sometimes(x => x.fast(2))

Version 3 (glitchy):
original.sometimes(x => x.chop(8).rev).rarely(x => x.speed(-1))
```

### Performance Optimization Tips

**Pattern Caching**
```
// The server caches patterns intelligently:
// - Generated patterns stored before browser init
// - Editor content cached for 100ms
// - Audio analysis cached for 50ms

// For fastest performance:
1. Generate patterns before initializing browser
2. Initialize once and reuse the session
3. Batch multiple changes together
```

**Headless Mode**
```json
// In config.json:
{
  "headless": true,  // Faster, no GUI
  "strudel_url": "https://strudel.cc/",
  "patterns_dir": "./patterns"
}
```

### Integration Patterns

**Workflow Automation**
```
You: Create a complete track:
     1. Start with techno drums at 130 BPM
     2. Add acid bassline in E
     3. Layer ambient pads
     4. Save as "track-001" with tags "techno", "acid", "experimental"

Claude: [Executes full workflow]
        [Initializes browser]
        [Generates drum pattern]
        [Adds bassline]
        [Layers pads]
        [Saves with metadata]

Complete! Pattern saved as "track-001"
```

**Audio-Reactive Composition**
```
You: Monitor the audio and suggest adjustments based on frequency balance

Claude: [Analyzes current playback]

Analysis shows:
- Bass: 180 (strong)
- Mid: 45 (weak)
- Treble: 30 (weak)

Recommendations:
1. Reduce bass gain by 20%
2. Add mid-range melodic content
3. Include hi-hat pattern for treble

Apply changes? [Yes/No]
```

### Advanced Pattern Manipulation

**Dynamic Transformations**
```
You: Apply these transformations in sequence:
     1. Transpose up 3 semitones
     2. Add 10% humanization
     3. Apply reverb with 0.6 room size
     4. Every 4th cycle, reverse the pattern

Claude: [Applies transformations]

Final pattern:
[original]
  .transpose(3)
  .nudge(rand.range(-0.1, 0.1))
  .room(0.6)
  .every(4, x => x.rev)
```

**Conditional Logic**
```
You: Create a pattern that evolves:
     - Bars 1-4: Simple kick pattern
     - Bars 5-8: Add snare
     - Bars 9-16: Add full drum kit
     - Then loop with variations

Claude: [Generates evolving pattern]

s("bd*4")
  .struct("1 ~ ~ ~")
  .mask("<1 1 1 1 0 0 0 0>/4")  // First 4 bars
  .stack(
    s("~ cp ~ cp")
      .mask("<0 0 0 0 1 1 1 1>/8")  // Bars 5-8
  )
  // Full complexity from bar 9
  .every(8, x => x.sometimes(y => y.fast(2)))
```

## 🔒 Security

### Pattern Validation

All patterns are validated before execution:
- **Dangerous gain levels** (>2.0) are flagged
- **Eval blocks** are rejected
- **Path traversal** attacks are blocked in PatternStore

### Browser Sandboxing

- Playwright runs Chromium in sandbox mode
- No access to local filesystem from browser context
- Resource blocking prevents loading external content

### Known Limitations

- **No authentication**: The MCP server trusts all incoming requests
- **Local only**: Designed for local development, not network deployment
- **Pattern execution**: Patterns execute in browser context with audio access

### Reporting Security Issues

Found a vulnerability? Please [open a security issue](https://github.com/williamzujkowski/live-coding-music-mcp/security/advisories/new) or email the maintainer directly. Do not disclose publicly until patched.

## 🐛 Troubleshooting

### Common Issues

#### Browser doesn't open
**Symptom**: `Error: Browser not initialized` or Chromium launch fails

**Solutions**:
```bash
# Install Chromium for Playwright
npx playwright install chromium

# If that fails, try installing all browsers
npx playwright install

# Check Playwright installation
npx playwright --version

# For Linux, install dependencies
sudo npx playwright install-deps chromium
```

#### Audio analysis returns "not connected"
**Symptom**: Audio analysis shows `connected: false`

**Solutions**:
1. Ensure pattern is playing first:
   ```
   You: Play the pattern, wait 2 seconds, then analyze
   ```

2. Reinitialize the browser:
   ```
   You: Stop, close the browser, reinitialize, and try again
   ```

3. Check audio context activation:
   - Audio contexts require user interaction on some systems
   - The browser window must be visible (not headless) for first run

#### Pattern syntax errors
**Symptom**: Pattern doesn't play or shows errors in console

**Solutions**:
```
Common issues:
1. Missing quotes: s(bd*4) → s("bd*4")
2. Unmatched parentheses: stack(s("bd")) → stack(s("bd")))
3. Invalid note names: note("h2") → note("c2")

Test with minimal pattern first:
s("bd*4")

Then build complexity gradually.
```

#### MCP connection issues
**Symptom**: Claude can't find the server or tools

**Solutions**:
```bash
# Verify server is built
npm run build

# Check if server responds
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js

# Should return JSON with 26 tools

# Reinstall MCP server in Claude
claude mcp remove strudel
claude mcp add strudel node $(pwd)/dist/index.js

# Restart Claude
claude chat
```

#### Performance issues / Slow response
**Symptom**: Operations take longer than expected

**Solutions**:
1. **Enable caching** (default, but verify):
   - Editor caching: 100ms TTL
   - Audio analysis: 50ms TTL

2. **Use headless mode** for faster operation:
   ```json
   // config.json
   { "headless": true }
   ```

3. **Batch operations**:
   ```
   Instead of:
   - Add drums
   - Add bass
   - Add melody

   Do:
   - Generate complete pattern with drums, bass, and melody
   ```

4. **Reduce browser overhead**:
   - Close other browser instances
   - Disable browser DevTools
   - Use resource blocking (enabled by default)

#### Patterns not saving
**Symptom**: `pattern_store({ action: "save" })` fails or patterns don't persist

**Solutions**:
```bash
# Check patterns directory exists
ls -la ./patterns

# Create manually if needed
mkdir -p ./patterns

# Verify write permissions
touch ./patterns/test.json
rm ./patterns/test.json

# Check for invalid pattern names
# Valid: "techno-beat-1", "my_pattern", "track001"
# Invalid: "pattern/with/slashes", "name:with:colons"
```

### Platform-Specific Issues

#### macOS
```bash
# Keyboard shortcut uses Meta (Cmd) key
# Already handled by ControlOrMeta

# If Chromium crashes on M1/M2:
npx playwright install chromium --with-deps
```

#### Linux
```bash
# Install system dependencies
sudo npx playwright install-deps chromium

# If running in Docker/headless environment:
# Ensure config.json has headless: true
```

#### Windows
```bash
# Use PowerShell or Git Bash
# Paths should use forward slashes in config.json

# If Chromium doesn't launch:
npx playwright install chromium
```

### Debugging Tips

**Enable Verbose Logging**
```bash
# Set environment variable
DEBUG=* node dist/index.js

# Or in Claude:
You: Enable detailed logging for the next operation
```

**Check Browser State**
```
You: Show me the current browser initialization state
     and any cached patterns

Claude: Browser state:
- Initialized: true
- Cached patterns: 2
- Undo stack depth: 5
- Last operation: edit_pattern (2.5s ago)
```

**Validate Pattern Syntax**
```
You: Before playing, validate this pattern syntax:
     s("bd*4, ~ cp ~ cp")

Claude: [Checks syntax]
Valid Strudel pattern.
Ready to play.
```

### Getting Help

If you encounter issues not covered here:

1. **Check existing issues**: [GitHub Issues](https://github.com/williamzujkowski/live-coding-music-mcp/issues)
2. **Run integration tests**: `npm run test:integration`
3. **Enable debug mode**: `DEBUG=* npm start`
4. **Consult Strudel docs**: [Strudel.cc documentation](https://strudel.cc/learn)
5. **Create new issue**: Include error messages, OS, Node version, and steps to reproduce

## 🤝 Contributing

PRs welcome — bug fixes, docs, tests, new tools. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the contribution guide and **[DEVELOPMENT.md](DEVELOPMENT.md)** for setup and workflow.

For non-trivial work, open a GitHub issue first ([issue policy in CLAUDE.md](CLAUDE.md#github-issues-workflow)). For typos and small fixes, a PR directly is fine.

[GitHub Discussions](https://github.com/williamzujkowski/live-coding-music-mcp/discussions) are open for use-case questions and design conversations.

## 📄 License

**AGPL-3.0-or-later** — see [LICENSE](LICENSE) for the full text.

This project depends on `@strudel/core`, `@strudel/mini`, `@strudel/tonal`, and `@strudel/transpiler`, which are AGPL-3.0 licensed by the upstream [Strudel project](https://codeberg.org/uzu/strudel). Since we `import` from those packages and redistribute the combined work via npm, this project must be distributed under the same copyleft terms. If you fork or redistribute, you must keep the AGPL license and provide source access to any network-accessible users (AGPL §13).

Earlier versions of this package (including `@williamzujkowski/strudel-mcp-server` prior to deprecation) shipped with an MIT declaration — that was incorrect given the AGPL dependencies. v2.0.0 of `@williamzujkowski/live-coding-music-mcp` corrects the license to AGPL-3.0-or-later. v1.0.0 of this package is deprecated; install v2.0.0 or later (current: v4.0.0).

## 🙏 Acknowledgments

- [Strudel.cc](https://strudel.cc) — pattern-based live coding environment (this project is a fan adapter, not affiliated)
- [TidalCycles](https://tidalcycles.org) — original pattern language Strudel descends from
- [Anthropic](https://anthropic.com) — Claude and the MCP protocol
- [Playwright](https://playwright.dev) — browser automation

---

**v4.0.0** — Open source, AGPL-3.0-or-later, experimental | [Report issues](https://github.com/williamzujkowski/live-coding-music-mcp/issues) | [Contribute](https://github.com/williamzujkowski/live-coding-music-mcp/pulls)

*This project is under active development. Core features work, but expect bugs and breaking changes. Not recommended for production use.*