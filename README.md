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
[![Tools](https://img.shields.io/badge/tools-84-green.svg)]()
[![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)

A Model Context Protocol (MCP) server that drives [Strudel.cc](https://strudel.cc/) from Claude for AI-assisted live-coding music, pattern generation, and algorithmic composition.

**Current State: Beta.** The core workflow (init → generate → write → play → analyze) works reliably with real audio output. 1771 tests pass, 86.76% statement coverage / 77.32% branch coverage. CI is hardened with OpenSSF Scorecard, SHA-pinned actions, CODEOWNERS, Dependabot, and lint as a blocking gate.

**What "Beta" means here:**
- Tool schemas are stable within minor versions; breaking changes require a major bump
- Multi-session is supported as of v3.0.0 ([#108](https://github.com/williamzujkowski/live-coding-music-mcp/issues/108)) — named sessions get isolated browser, history, and audio-capture state
- Upstream `@strudel/*` dependencies pinned to known-good versions; Dependabot bumps gated on CI
- Expect hands-on iteration for non-standard patterns — report rough edges, they get fixed

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Reference](#quick-reference)
- [Quick Start](#quick-start)
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
- **84 MCP tools** covering pattern editing, playback, audio analysis, generation, history, sessions, and Gemini-backed assists. 26 are the canonical consolidated tools (`pattern_store`, `edit_pattern`, `transform`, `analyze`, `history`, `playback`, `effect`, `shape`, `audio_capture`, `browser_window`, `generate_part`, `generate_rhythm`, `music_theory`, `session`, `ai_assist`, ...); the rest are deprecated aliases kept for one release ([#178](https://github.com/williamzujkowski/live-coding-music-mcp/issues/178)).
- **4 MCP resources** for catalog browsing without burning tool calls: `strudel://examples`, `strudel://patterns`, `strudel://styles`, `strudel://docs/tools`.
- **Real browser automation** of Strudel.cc through Playwright.
- **Multi-session support** — every browser-touching tool accepts an optional `session_id`; sessions have isolated browser pages, undo/redo/history stacks, and audio-capture services.
- **Audio analysis** via Web Audio API (FFT spectrum, tempo detection, key detection, rhythm complexity).
- **Template-based pattern generation** across 8 genres (techno, house, dnb, ambient, trap, jungle, jazz, experimental); optional Gemini-backed `ai_assist` for feedback, suggestions, and jamming.
- **Music theory helpers**: 15+ scales, 8+ chord progression styles, euclidean and polyrhythm generation.
- **Pattern persistence**: JSON-backed save/load with tags + the in-memory edit history (undo/redo/restore/compare).
- **Result envelope** on every `tools/call`: clients branch on `{ ok, errorCategory, isRetryable }` instead of parsing free-text.

### 🔧 Testing & CI status
- **1771 passing tests** across unit, integration, and example-validation suites.
- **86.76% statement coverage / 77.32% branch coverage**.
- **Lint blocking in CI**: 0 errors, ~163 warnings (mostly `any` in test mocks).
- **OIDC trusted publishing** to npm with SLSA build provenance attestation on every release.

**Not Production-Ready:** This is experimental software under active development. Use for exploration and experimentation. Expect breaking changes, bugs, and incomplete features. See [CONTRIBUTING.md](CONTRIBUTING.md) to help improve it.

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

## Quick Reference

Common commands for immediate use:

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

The legacy single-verb tools (`play`, `stop`, `save`, `undo`, `write`, `generate_pattern`, ...) still work in v3.0 as deprecated aliases. They forward to the consolidated tools and will be removed in v3.1 ([#178](https://github.com/williamzujkowski/live-coding-music-mcp/issues/178)).

**One-shot workflow:**
```
compose with style: "dnb", key: "Am", bpm: 174, auto_play: true
```

## Quick Start

### 1. Add to Claude
```bash
# If installed globally
claude mcp add strudel live-coding-music-mcp

# If built from source
claude mcp add strudel node /path/to/live-coding-music-mcp/dist/index.js
```

### 2. Start Using
```bash
claude chat
```

Then ask Claude:
- "Initialize Strudel and create a techno beat"
- "Generate a jazz chord progression in F major"
- "Create a drum & bass pattern at 174 BPM"

## Available Tools

<!-- TOOLS:START -->

**84 tools** across 15 categories:

<details><summary><strong>Setup</strong> (1)</summary>

| Tool | Description |
|------|-------------|
| `init` | Initialize Strudel in browser |

</details>

<details><summary><strong>Pattern Editing</strong> (5)</summary>

| Tool | Description |
|------|-------------|
| `get_pattern` | Get current pattern code |
| `write` | [DEPRECATED — use edit_pattern({ mode: "write" }) instead] Write pattern to editor with optional auto-play and validation |
| `append` | [DEPRECATED — use edit_pattern({ mode: "append" }) instead] Append code to current pattern |
| `insert` | [DEPRECATED — use edit_pattern({ mode: "insert" }) instead] Insert code at specific line |
| `replace` | [DEPRECATED — use edit_pattern({ mode: "replace" }) instead] Replace pattern section |

</details>

<details><summary><strong>Playback</strong> (6)</summary>

| Tool | Description |
|------|-------------|
| `status` | [DEPRECATED — use diagnostics({ level: "status" }) instead] Get current browser and playback status (quick state check) |
| `clear` | [DEPRECATED — use edit_pattern({ mode: "clear" }) instead] Clear the editor |
| `play` | [DEPRECATED — use playback({ action: "play" }) instead] Start playing pattern |
| `pause` | [DEPRECATED — use playback({ action: "pause" }) instead] Pause playback |
| `stop` | [DEPRECATED — use playback({ action: "stop" }) instead] Stop playback |
| `set_tempo` | Set BPM |

</details>

<details><summary><strong>Storage</strong> (3)</summary>

| Tool | Description |
|------|-------------|
| `save` | [DEPRECATED — use pattern_store({ action: "save" }) instead] Save pattern with metadata |
| `load` | [DEPRECATED — use pattern_store({ action: "load" }) instead] Load saved pattern |
| `list` | [DEPRECATED — use pattern_store({ action: "list" }) instead] List saved patterns |

</details>

<details><summary><strong>History</strong> (4)</summary>

| Tool | Description |
|------|-------------|
| `undo` | [DEPRECATED — use history({ action: "undo" }) instead] Undo last action |
| `redo` | [DEPRECATED — use history({ action: "redo" }) instead] Redo action |
| `list_history` | [DEPRECATED — use history({ action: "list" }) instead] List recent pattern history with timestamps and previews |
| `restore_history` | [DEPRECATED — use history({ action: "restore" }) instead] Restore a previous pattern from history by ID |

</details>

<details><summary><strong>Generation</strong> (8)</summary>

| Tool | Description |
|------|-------------|
| `compose` | Generate, write, and play a complete pattern in one step. Auto-initializes default browser if needed. |
| `generate_pattern` | [DEPRECATED — use compose instead, which auto-inits and returns richer metadata] Generate complete pattern from style with optional auto-play. |
| `generate_drums` | [DEPRECATED — use generate_part({ role: "drums" }) instead] Generate drum pattern |
| `generate_bassline` | [DEPRECATED — use generate_part({ role: "bass" }) instead] Generate bassline |
| `generate_melody` | [DEPRECATED — use generate_part({ role: "melody" }) instead] Generate melody from scale |
| `generate_polyrhythm` | [DEPRECATED — use generate_rhythm({ type: "polyrhythm" }) instead] Generate polyrhythm |
| `generate_fill` | [DEPRECATED — use generate_part({ role: "fill" }) instead] Generate drum fill |
| `generate_variation` | [DEPRECATED — use transform({ op: "vary" }) instead] Create pattern variations (mis-named today; it transforms, not generates) |

</details>

<details><summary><strong>Music Theory</strong> (4)</summary>

| Tool | Description |
|------|-------------|
| `generate_scale` | [DEPRECATED — use music_theory({ query: "scale" }) instead] Generate scale notes |
| `generate_chord_progression` | [DEPRECATED — use music_theory({ query: "chord_progression" }) instead] Generate chord progression |
| `generate_euclidean` | [DEPRECATED — use generate_rhythm({ type: "euclidean" }) instead] Generate Euclidean rhythm |
| `apply_scale` | [DEPRECATED — use transform({ op: "scale" }) instead] Apply scale to notes |

</details>

<details><summary><strong>Transform</strong> (9)</summary>

| Tool | Description |
|------|-------------|
| `transpose` | [DEPRECATED — use transform({ op: "transpose" }) instead] Transpose notes by semitones |
| `reverse` | [DEPRECATED — use transform({ op: "reverse" }) instead] Reverse pattern |
| `stretch` | [DEPRECATED — use transform({ op: "stretch" }) instead] Time stretch pattern |
| `quantize` | [DEPRECATED — use transform({ op: "quantize" }) instead] Quantize to grid |
| `humanize` | [DEPRECATED — use transform({ op: "humanize" }) instead] Add human timing variation |
| `add_effect` | [DEPRECATED — use effect({ action: "add" }) instead] Add effect to pattern |
| `remove_effect` | [DEPRECATED — use effect({ action: "remove" }) instead] Remove effect |
| `add_swing` | [DEPRECATED — use transform({ op: "swing" }) instead] Add swing to pattern |
| `set_energy` | [DEPRECATED — use shape({ dimension: "energy" }) instead] Adjust energy level 0-10. Auto-plays after applying. |

</details>

<details><summary><strong>AI</strong> (4)</summary>

| Tool | Description |
|------|-------------|
| `get_pattern_feedback` | [DEPRECATED — use ai_assist({ task: "feedback" }) instead] Get AI-powered creative feedback on the current pattern using Google Gemini. |
| `jam_with` | [DEPRECATED — use ai_assist({ task: "jam" }) instead] AI generates a complementary layer to jam with your pattern. |
| `shift_mood` | [DEPRECATED — use shape({ dimension: "mood" }) instead] Transform current pattern to match a different emotional mood. Moods: dark, euphoric, melancholic, aggressive, dreamy, peaceful, energetic. |
| `refine` | [DEPRECATED — use shape({ dimension: "refine" }) instead] Incrementally refine current pattern: faster/slower/louder/quieter/brighter/darker/"more reverb"/drier. |

</details>

<details><summary><strong>Analysis</strong> (7)</summary>

| Tool | Description |
|------|-------------|
| `analyze` | Audio analysis on the currently-playing pattern.  |
| `analyze_spectrum` | [DEPRECATED — use analyze({ include: ["spectrum"] }) instead] FFT spectrum analysis |
| `analyze_rhythm` | [DEPRECATED — use analyze({ include: ["rhythm"] }) instead] Rhythm analysis |
| `detect_tempo` | [DEPRECATED — use analyze({ include: ["tempo"] }) instead] BPM detection |
| `detect_key` | [DEPRECATED — use analyze({ include: ["key"] }) instead] Key detection |
| `validate_pattern_runtime` | Validate pattern with runtime error checking (monitors Strudel console for errors) |
| `compare_patterns` | [DEPRECATED — use history({ action: "compare" }) instead] Compare two patterns from history showing differences |

</details>

<details><summary><strong>Session</strong> (4)</summary>

| Tool | Description |
|------|-------------|
| `create_session` | [DEPRECATED — use session({ action: "create" }) instead] Create a new isolated Strudel browser session. |
| `destroy_session` | [DEPRECATED — use session({ action: "destroy" }) instead] Close and destroy a Strudel session. |
| `list_sessions` | [DEPRECATED — use session({ action: "list" }) instead] List all active Strudel sessions. |
| `switch_session` | [DEPRECATED — use session({ action: "switch" }) instead] Change the default session. |

</details>

<details><summary><strong>Export</strong> (2)</summary>

| Tool | Description |
|------|-------------|
| `export_midi` | Export current pattern to MIDI file. Parses note(), n(), and chord() functions. |
| `screenshot` | [DEPRECATED — use browser_window({ action: "screenshot" }) instead] Take a screenshot of the current Strudel editor state |

</details>

<details><summary><strong>Audio</strong> (3)</summary>

| Tool | Description |
|------|-------------|
| `start_audio_capture` | [DEPRECATED — use audio_capture({ action: "start" }) instead] Start capturing audio. Audio must be playing. |
| `stop_audio_capture` | [DEPRECATED — use audio_capture({ action: "stop" }) instead] Stop audio capture and return base64-encoded audio. |
| `capture_audio_sample` | [DEPRECATED — use audio_capture({ action: "sample" }) instead] Capture a fixed-duration audio sample. |

</details>

<details><summary><strong>Debug</strong> (5)</summary>

| Tool | Description |
|------|-------------|
| `show_browser` | [DEPRECATED — use browser_window({ action: "show" }) instead] Bring browser window to foreground |
| `diagnostics` | Inspect server and browser state.  |
| `show_errors` | [DEPRECATED — use diagnostics({ level: "errors" }) instead] Display captured console errors and warnings from Strudel |
| `performance_report` | [DEPRECATED — use diagnostics({ level: "perf" }) instead] Get performance metrics and bottlenecks |
| `memory_usage` | [DEPRECATED — use diagnostics({ level: "memory" }) instead] Get current memory usage statistics |

</details>

<details><summary><strong>Other</strong> (19)</summary>

| Tool | Description |
|------|-------------|
| `ai_assist` | Gemini-backed pattern assistance.  |
| `suggest_pattern_from_audio` | [DEPRECATED — use ai_assist({ task: "suggest" }) instead] Analyze playing audio and suggest a complementary Strudel pattern. |
| `validate_pattern_local` | Validate pattern syntax against the in-process StrudelEngine (no browser required) |
| `analyze_pattern_local` | Static analysis (events/cycle, complexity, optional BPM) without browser playback |
| `query_pattern_events` | Enumerate events the pattern would emit between two cycle indices (max 16 cycles) |
| `transpile_pattern` | Transpile pattern source via StrudelEngine; returns transpiled code or syntax error |
| `audio_capture` | Record audio output from the live Strudel session.  |
| `browser_window` | Interact with the visible Strudel browser window.  |
| `edit_pattern` | Mutate the current session pattern.  |
| `generate_part` | Generate a single instrumental layer and append it to the current session pattern.  |
| `music_theory` | Music-theory queries.  |
| `generate_rhythm` | Generate a rhythmic pattern and append it to the current session.  |
| `history` | Navigate or inspect the pattern edit history.  |
| `playback` | Control transport on the current session.  |
| `session` | Manage isolated Strudel browser sessions (multi-session, #108).  |
| `pattern_store` | Persist patterns to disk and read them back.  |
| `transform` | Apply a single transform op to the current session pattern.  |
| `effect` | Add or remove a Strudel effect on the current session pattern.  |
| `shape` | Shape the current pattern along one of three high-level dimensions.  |

</details>

_Auto-generated from source. 84 tools registered._

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

All tools have been tested with real Strudel.cc interaction:

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
    "fft_size": 2048,
    "smoothing": 0.8
  }
}
```

## Architecture

### System Overview

The Strudel MCP Server is built with a modular architecture that separates concerns and enables robust music generation:

```
┌─────────────────────────────────────────────────────────────┐
│                       Claude AI                              │
│                  (MCP Client)                                │
└───────────────────────┬─────────────────────────────────────┘
                        │ MCP Protocol (stdio)
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              StrudelMCPServer                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Tool Request Handler                                  │ │
│  │  - Validates inputs                                    │ │
│  │  - Routes to appropriate service                       │ │
│  │  - Handles errors gracefully                           │ │
│  └────────────────────────────────────────────────────────┘ │
└───────┬────────────┬────────────┬───────────┬──────────────┘
        │            │            │           │
   ┌────▼────┐  ┌───▼────┐  ┌───▼────┐  ┌──▼──────┐
   │ Strudel │  │ Music  │  │Pattern │  │ Pattern │
   │Controller│  │ Theory │  │Generator│  │  Store  │
   └────┬────┘  └────────┘  └────────┘  └─────────┘
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

### Core Components

#### 1. **StrudelMCPServer** (`src/server/server.ts`, ~510 lines)

Thin MCP dispatcher that:
- Aggregates 84 tool definitions from the per-domain modules in `src/server/tools/` (84 = 26 consolidated tools + 58 deprecated aliases; -58 once #178 lands)
- Routes `tools/call` requests to the right module's `execute()`
- Wraps every response in the discriminated result envelope (`{ ok, errorCategory, isRetryable, ... }`)
- Tracks initialization, per-session history bundles, per-session audio capture services
- Advertises and serves MCP resources (`strudel://examples`, etc.)
- Lazy-initializes the default browser controller on first browser-touching call

Key Features:
```typescript
- Pattern caching before browser init
- Undo/redo stack management
- Session history tracking
- Generated pattern storage
- Safe fallback mechanisms
```

#### 2. **StrudelController** (`src/StrudelController.ts`)

Browser automation layer using Playwright:
- **Browser Management**: Chromium instance lifecycle
- **Editor Control**: CodeMirror manipulation via DOM
- **Playback Control**: Keyboard shortcuts for play/stop
- **Performance Optimizations**:
  - Editor content caching (100ms TTL)
  - Direct CodeMirror API access
  - Resource blocking (images, fonts)
  - Fast DOM content loading

```typescript
// Example: Optimized pattern writing
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

#### 3. **AudioAnalyzer** (`src/AudioAnalyzer.ts`)

Real-time audio analysis via Web Audio API injection:
- **FFT Analysis**: 1024-point FFT for spectral data
- **Frequency Bands**: Bass, low-mid, mid, high-mid, treble
- **Analysis Caching**: 50ms TTL for performance
- **Features Extracted**:
  - Average amplitude
  - Peak frequency
  - Spectral centroid
  - Playing state detection
  - Frequency distribution

```typescript
Features provided:
- average: Overall amplitude (0-255)
- peak: Maximum amplitude
- peakFrequency: Dominant frequency in Hz
- bass/mid/treble: Band-specific amplitudes
- brightness: Timbral classification
- isPlaying: Boolean playback state
```

#### 4. **MusicTheory** (`src/services/MusicTheory.ts`)

Music theory engine providing:
- **15+ Scales**: Major, minor, modes, pentatonic, blues, whole-tone
- **Chord Progressions**: Pop, jazz, blues, rock, folk, EDM
- **Euclidean Rhythms**: Mathematical rhythm generation
- **Arpeggio Generation**: Multiple patterns (up, down, random)
- **Note Transposition**: Semitone-based pitch shifting

Supported scales:
```typescript
major, minor, dorian, phrygian, lydian, mixolydian,
aeolian, locrian, pentatonic, blues, chromatic,
wholetone, harmonic_minor, melodic_minor
```

#### 5. **PatternGenerator** (`src/services/PatternGenerator.ts`)

AI-powered pattern creation:
- **Genre Templates**: Techno, house, DnB, trap, ambient, jazz, intelligent_dnb, trip_hop, boom_bap
- **Drum Patterns**: 4 complexity levels per genre
- **Basslines**: 8 different styles
- **Melody Generation**: Scale-based with musical intervals
- **Variations**: Subtle, moderate, extreme, glitch, evolving
- **Fills**: 1-4 bar drum fills

Example generation:
```typescript
generateCompletePattern('techno', 'C', 130)
→ Multi-layer pattern with drums, bass, chords, melody
```

#### 6. **PatternStore** (`src/PatternStore.ts`)

Persistent pattern storage:
- **JSON-based**: Simple file storage
- **Metadata**: Name, tags, timestamp, audio features
- **Tag Filtering**: Organize by genre, mood, project
- **Sorted Retrieval**: Most recent first

### Directory Structure

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

### Data Flow

1. **Tool Invocation**
   ```
   Claude → MCP Protocol → StrudelMCPServer
   ```

2. **Pattern Generation** (without browser)
   ```
   Server → PatternGenerator → MusicTheory → Pattern String
   ```

3. **Pattern Execution** (with browser)
   ```
   Server → StrudelController → Playwright → Strudel.cc
   ```

4. **Audio Analysis**
   ```
   Strudel.cc → Web Audio API → AudioAnalyzer → Feature Data
   ```

### Performance Characteristics

| Operation | Latency | Notes |
|-----------|---------|-------|
| Pattern Generation | <100ms | Pure computation |
| Browser Init | ~3s | One-time cost |
| Pattern Write | ~50ms | With caching |
| Play/Stop | ~100ms | Keyboard shortcuts |
| Audio Analysis | ~20ms | With 50ms cache |
| Pattern Save | ~10ms | File I/O |

### Optimization Strategies

1. **Caching**
   - Editor content: 100ms TTL
   - Audio analysis: 50ms TTL
   - Generated patterns: Until browser init

2. **Resource Blocking**
   - Images, fonts, media blocked
   - Only load essential JavaScript/CSS

3. **Direct API Access**
   - CodeMirror view manipulation
   - Keyboard shortcuts over button clicks

4. **Lazy Loading**
   - Browser starts only when needed
   - Services initialized on-demand

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

### Setup Development Environment

```bash
# Clone the repository
git clone https://github.com/williamzujkowski/live-coding-music-mcp.git
cd live-coding-music-mcp

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Build the project
npm run build
```

### Available Scripts

```bash
# Development mode with hot reload
npm run dev

# Build TypeScript to dist/
npm run build

# Start production server
npm start

# Run all tests
npm test

# Run integration tests with real browser
npm run test:integration

# Run browser-specific tests
npm run test:browser

# Validate MCP protocol compliance
npm run validate

# Lint code
npm run lint

# Format code
npm run format

# Clean build artifacts
npm clean
```

### Publishing to npm

See [NPM_PUBLISHING.md](NPM_PUBLISHING.md) for complete publishing instructions.

**Quick publish via GitHub Release:**
```bash
npm version patch  # or minor, major
git push && git push --tags
gh release create v$(node -p "require('./package.json').version") --generate-notes
```

The package uses OIDC trusted publishing with provenance attestation for supply chain security.

### Adding new tools

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

4. **Don't hand-edit the README tool table.** It auto-generates via `npm run build` → `scripts/generate-tool-docs.ts`. A Jest test plus a CI step guard against drift.

5. **Use the envelope helpers** for returns: `ok(data)`, `empty(data)`, `err('validation', 'message')` from `src/server/tools/types.ts`. Raw returns still work — the dispatcher normalises them — but native envelope construction is clearer.

6. **Build and test**:

   ```bash
   npm run build
   echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"my_new_tool","arguments":{"param1":"test"}},"id":2}' | node dist/index.js
   ```

### Testing Strategy

#### 1. Unit Tests
```bash
# Run with Jest
npm test

# Watch mode
npm run test:watch
```

#### 2. Integration Tests
```bash
# Full integration with real browser
npm run test:integration

# This tests:
# - Browser initialization
# - Pattern generation
# - Audio analysis
# - Pattern storage
# - All 84 registered tools
```

#### 3. Manual Testing
```bash
# Development mode
npm run dev

# In another terminal
claude mcp add strudel-dev node $(pwd)/dist/index.js
claude chat

# Then interact with Claude
```

### Code Quality

**TypeScript Configuration**
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,           // Strict type checking
    "esModuleInterop": true,  // Better module compatibility
    "target": "ES2020",       // Modern JavaScript
    "module": "ES2020",       // ES modules
    "moduleResolution": "node"
  }
}
```

**Linting & Formatting**
```bash
# ESLint
npm run lint

# Prettier
npm run format

# Pre-commit hooks recommended
```

### Debugging

**Enable Debug Logging**
```bash
# Set DEBUG environment variable
DEBUG=strudel:* npm start

# Or specific modules
DEBUG=strudel:controller npm start
DEBUG=strudel:audio npm start
```

**VS Code Launch Configuration**
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug MCP Server",
  "program": "${workspaceFolder}/dist/index.js",
  "preLaunchTask": "npm: build",
  "console": "integratedTerminal",
  "env": {
    "DEBUG": "strudel:*"
  }
}
```

**Playwright Debugging**
```typescript
// In StrudelController.ts
this.browser = await chromium.launch({
  headless: false,  // See the browser
  devtools: true,   // Open DevTools
  slowMo: 100       // Slow down actions
});
```

### Performance Monitoring

The server includes built-in performance monitoring:

```typescript
// Access performance metrics
You: Show me performance metrics

Claude: Performance Report:
{
  "averageLatency": {
    "init": "3.2s",
    "write": "52ms",
    "play": "105ms",
    "analyze": "18ms"
  },
  "cacheHitRate": "85%",
  "totalOperations": 1247,
  "bottlenecks": [
    {"tool": "init", "avgTime": 3200, "calls": 1},
    {"tool": "write", "avgTime": 52, "calls": 156}
  ]
}
```

### Contributing Guidelines

1. **Fork the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/live-coding-music-mcp.git
   ```

2. **Create a feature branch**
   ```bash
   git checkout -b feature/my-new-feature
   ```

3. **Make your changes**
   - Follow existing code style
   - Add tests for new features
   - Update documentation
   - Ensure all tests pass

4. **Commit with meaningful messages**
   ```bash
   git commit -m "feat: Add support for custom scale generation"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `refactor:` Code refactoring
   - `test:` Adding tests
   - `chore:` Maintenance tasks

5. **Push and create PR**
   ```bash
   git push origin feature/my-new-feature
   ```

   Then create a Pull Request on GitHub with:
   - Clear description of changes
   - Link to related issues
   - Screenshots/examples if relevant

### Release Process

```bash
# 1. Update version in package.json
npm version patch  # or minor/major

# 2. Update CHANGELOG.md
# Add entry for new version

# 3. Build and test
npm run build
npm test
npm run test:integration

# 4. Commit version bump
git add .
git commit -m "chore: Bump version to X.Y.Z"

# 5. Create git tag
git tag vX.Y.Z

# 6. Push to GitHub
git push origin main --tags

# 7. Publish to npm (if you have access)
npm publish --access public

# 8. Create GitHub release
gh release create vX.Y.Z --generate-notes
```

### Docker Development

```bash
# Build development image
docker build -t live-coding-music-mcp:dev .

# Run with volume mount for hot reload
docker run -it --rm \
  -v $(pwd)/src:/app/src \
  -v $(pwd)/patterns:/app/patterns \
  live-coding-music-mcp:dev

# Run tests in container
docker run -it --rm live-coding-music-mcp:dev npm test
```

### Environment Variables

```bash
# Logging level
LOG_LEVEL=debug        # debug, info, warn, error

# Performance monitoring
ENABLE_PERF_MONITORING=true

# Pattern storage
PATTERNS_DIR=./patterns

# Browser configuration
HEADLESS=false
BROWSER_TIMEOUT=15000

# Audio analysis
FFT_SIZE=1024
SMOOTHING=0.8
```

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

# Should return JSON with 84 tools (post-v3.0; ~26 after #178 alias removal)

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
**Symptom**: `save` command fails or patterns don't persist

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
- Last operation: write_pattern (2.5s ago)
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

**We need your help!** This project is actively developed and welcomes contributions of all kinds:

### Ways to Contribute
- **Report Bugs**: Found an issue? [Open a bug report](https://github.com/williamzujkowski/live-coding-music-mcp/issues/new)
- **Suggest Features**: Have ideas? [Create a feature request](https://github.com/williamzujkowski/live-coding-music-mcp/issues/new)
- **Improve Docs**: Fix typos, add examples, clarify confusing sections
- **Write Tests**: Help us improve test coverage
- **Fix Issues**: Check [open issues](https://github.com/williamzujkowski/live-coding-music-mcp/issues) for bugs to fix
- **Add Features**: Implement new tools or improve existing ones

### Quick Start for Contributors
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes and add tests
4. Ensure tests pass (`npm test`)
5. Commit with clear messages (`git commit -m 'fix: resolve audio analysis bug'`)
6. Push to your fork (`git push origin feature/amazing-feature`)
7. Open a Pull Request

**First time contributor?** Look for issues labeled `good-first-issue` or `help-wanted`.

### Feedback Welcome
- Questions? Open a [Discussion](https://github.com/williamzujkowski/live-coding-music-mcp/discussions)
- Found something confusing? Tell us!
- Have a use case we haven't considered? Share it!

We review PRs promptly and welcome contributors of all skill levels. See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed setup instructions.

## 📄 License

**AGPL-3.0-or-later** — see [LICENSE](LICENSE) for the full text.

This project depends on `@strudel/core`, `@strudel/mini`, `@strudel/tonal`, and `@strudel/transpiler`, which are AGPL-3.0 licensed by the upstream [Strudel project](https://codeberg.org/uzu/strudel). Since we `import` from those packages and redistribute the combined work via npm, this project must be distributed under the same copyleft terms. If you fork or redistribute, you must keep the AGPL license and provide source access to any network-accessible users (AGPL §13).

Earlier versions of this package (including `@williamzujkowski/strudel-mcp-server` prior to deprecation) shipped with an MIT declaration — that was incorrect given the AGPL dependencies. v2.0.0 of `@williamzujkowski/live-coding-music-mcp` corrects the license to AGPL-3.0-or-later. v1.0.0 of this package is deprecated; install v2.0.0 or later.

## 🙏 Acknowledgments

- [Strudel.cc](https://strudel.cc) - Amazing live coding environment
- [TidalCycles](https://tidalcycles.org) - Pattern language inspiration
- [Anthropic](https://anthropic.com) - Claude AI and MCP protocol
- [Playwright](https://playwright.dev) - Reliable browser automation

---

**v3.0.0** — Open source, AGPL-3.0-or-later, experimental | [Report issues](https://github.com/williamzujkowski/live-coding-music-mcp/issues) | [Contribute](https://github.com/williamzujkowski/live-coding-music-mcp/pulls)

*This project is under active development. Core features work, but expect bugs and breaking changes. Not recommended for production use.*