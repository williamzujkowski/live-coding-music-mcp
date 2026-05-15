# Strudel Pattern Examples

Curated collection of music patterns showcasing the MCP server's generation capabilities across different genres.

## Directory Structure

```
examples/
├── techno/    - Hard driving beats, acid basslines, 120-140 BPM
├── house/     - 4/4 groove, soulful chords, 120-130 BPM
├── dnb/       - Fast breakbeats, sub bass, 160-180 BPM
├── ambient/   - Atmospheric pads, slow tempo, 60-90 BPM
├── trap/      - 808 bass, hi-hat rolls, 130-150 BPM
├── jungle/    - Chopped breaks, reggae influence, 160-180 BPM
├── jazz/      - Swing feel, complex chords, 100-180 BPM
└── longform/  - Multi-minute pieces (dark-ambient journey, driving techno, etc.)
```

## Pattern Format

Each pattern is stored as JSON with metadata:

```json
{
  "name": "Hard Techno",
  "genre": "techno",
  "pattern": "s(\"bd*4, cp*2\").fast(2)",
  "bpm": 135,
  "key": "Am",
  "description": "Driving 4/4 techno with acid bassline",
  "tags": ["techno", "hard", "acid"],
  "timestamp": "2025-12-13T04:15:00.000Z"
}
```

## Usage

### Via MCP Tools

Load patterns using the MCP server:

Agents can browse the bundled examples through the `strudel://examples` MCP resource without burning tool calls. To load and play one through the tools:

```typescript
// List saved patterns (on-disk catalog)
await client.call("pattern_store", { action: "list" });

// Load a specific pattern into the current session
await client.call("pattern_store", { action: "load", name: "hard-techno" });

// Play it
await client.call("playback", { action: "play" });
```

### Manual Testing

```bash
# Generate + write + play a full pattern in one tool call
echo '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"compose","arguments":{"style":"techno","tempo":135,"key":"Am"}}}' | \
  node dist/index.js

# Save the current session pattern under a name
echo '{"jsonrpc":"2.0","method":"tools/call","id":2,"params":{"name":"pattern_store","arguments":{"action":"save","name":"my-pattern","tags":["techno"]}}}' | \
  node dist/index.js
```

## Genre Characteristics

### Techno
- **BPM**: 120-140
- **Key signatures**: Minor scales (Am, Em, Dm)
- **Elements**: Hard kicks, acid basslines, minimal melodic content
- **Patterns**: Repetitive, hypnotic, 4/4 time

### House
- **BPM**: 120-130
- **Key signatures**: Minor and major (Dm, Am, C, F)
- **Elements**: Soulful chords, groovy basslines, shuffle hi-hats
- **Patterns**: 4/4 groove, emphasis on beats 2 and 4

### Drum & Bass (DnB)
- **BPM**: 160-180
- **Key signatures**: Minor scales (Em, F#m, Cm)
- **Elements**: Fast breakbeats, sub bass, atmospheric pads
- **Patterns**: Syncopated drums, half-time feel

### Ambient
- **BPM**: 60-90
- **Key signatures**: Open tunings, modal scales (C, G, Dm)
- **Elements**: Atmospheric pads, long releases, sparse rhythms
- **Patterns**: Evolving textures, minimal percussion

### Trap
- **BPM**: 130-150
- **Key signatures**: Minor scales (F#m, Bm, Gm)
- **Elements**: 808 bass, rapid hi-hats, snare rolls
- **Patterns**: Half-time drums, triplet hi-hats

### Jungle
- **BPM**: 160-180
- **Key signatures**: Minor scales (Gm, Dm, Am)
- **Elements**: Chopped amen breaks, reggae basslines, dub effects
- **Patterns**: Complex breakbeat manipulation, call-and-response

### Jazz
- **BPM**: 100-180 (varies by subgenre)
- **Key signatures**: Complex (Bb, Eb, modal scales)
- **Elements**: Swing feel, extended chords (7ths, 9ths, 11ths)
- **Patterns**: Syncopation, improvisation-friendly

## Quality Standards

All example patterns meet these criteria:

- ✅ **Syntactically valid** - No errors when loaded
- ✅ **Genre-appropriate** - BPM and characteristics match genre
- ✅ **Musically coherent** - Sounds intentional, not random
- ✅ **Well-documented** - Clear metadata and description
- ✅ **Tested** - Validated via automated test suite

## Contributing Examples

Add new examples via the validation test suite:

1. Generate pattern using MCP tools
2. Validate it plays correctly
3. Add to appropriate genre directory
4. Update genre-specific README if needed
5. Run validation tests: `npm test -- GenreValidation`

## Validation

Examples are validated by `src/__tests__/validation/GenreValidation.test.ts`:

- Pattern syntax correctness
- Genre-appropriate tempo ranges
- Audio analysis validation
- Metadata completeness

Run validation: `npm test -- GenreValidation`

