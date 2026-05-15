export const samplePatterns = {
  simple: 's("bd*4")',

  techno: `s("bd*4, ~ cp ~ cp, hh*8").room(0.2)`,

  house: `stack(
  s("bd*4"),
  s("~ cp ~ cp"),
  s("[~ hh]*4")
).gain(0.8)`,

  dnb: `stack(
  s("bd ~ ~ bd ~ ~ bd ~"),
  s("~ ~ cp ~ ~ cp ~ ~"),
  s("hh*16")
).fast(2)`,

  withBass: `stack(
  s("bd*4, ~ cp ~ cp"),
  note("c2 c2 c2 c2").s("sawtooth").cutoff(800)
)`,

  complex: `setcpm(130)

stack(
  // Drums
  s("bd*4, ~ cp ~ cp, [~ hh]*4").room(0.2),

  // Bass
  note("c2 c2 c2 c2").s("sawtooth").cutoff(800),

  // Melody
  note("c4 e4 g4 e4").s("triangle").struct("~ 1 ~ 1").delay(0.25)
).gain(0.8)`,

  euclidean: `s("bd").euclid(5, 8)`,

  polyrhythm: `stack(
  s("bd").euclid(3, 16),
  s("cp").euclid(5, 16),
  s("hh").euclid(7, 16)
)`,

  withEffects: `s("bd*4").room(0.9).delay(0.5).gain(0.7)`,

  invalid: `this is not valid strudel code`,

  syntaxError: `s("bd*4"`,

  empty: '',

  veryLong: 's("bd*4")' + '.sometimes(x => x.fast(2))'.repeat(50)
};

export const musicalContexts = {
  cmajor: {
    key: 'C',
    scale: 'major',
    notes: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
    chords: ['C', 'F', 'G', 'Am']
  },

  aminor: {
    key: 'A',
    scale: 'minor',
    notes: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    chords: ['Am', 'Dm', 'E', 'C']
  },

  gmajor: {
    key: 'G',
    scale: 'major',
    notes: ['G', 'A', 'B', 'C', 'D', 'E', 'F#'],
    chords: ['G', 'C', 'D', 'Em']
  },

  ddorian: {
    key: 'D',
    scale: 'dorian',
    notes: ['D', 'E', 'F', 'G', 'A', 'B', 'C'],
    chords: ['Dm', 'Em', 'F', 'G']
  }
};

export const drumPatterns = {
  fourOnFloor: 'bd*4',
  twoStep: 'bd ~ bd ~',
  breakbeat: 'bd ~ ~ bd ~ ~ ~ bd',
  dnbBreak: 'bd ~ ~ bd ~ ~ bd ~',
  trap: 'bd [bd bd] ~ bd',
  euclidean3_8: '1 ~ ~ 1 ~ ~ 1 ~',
  euclidean5_16: '1 ~ ~ 1 ~ ~ 1 ~ 1 ~ ~ 1 ~ ~ 1 ~'
};

export const basslinePatterns = {
  techno: 'c2 c2 c2 c2',
  house: 'c2 ~ c2 ~',
  acid: 'c2 c3 c2 d#2',
  dub: 'c1 ~ ~ ~ c1 ~ f1 ~',
  walking: 'c2 d2 e2 f2'
};

export const testMetadata = {
  tags: {
    genre: ['techno', 'house', 'dnb', 'ambient', 'experimental'],
    mood: ['dark', 'energetic', 'chill', 'aggressive', 'atmospheric'],
    complexity: ['simple', 'moderate', 'complex'],
    type: ['drums', 'bass', 'melody', 'full', 'effect']
  },

  bpms: {
    ambient: 80,
    house: 125,
    techno: 130,
    dnb: 174,
    trap: 140
  },

  keys: ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C#', 'D#', 'F#', 'G#', 'A#']
};

export const audioFeatures = {
  silent: {
    connected: true,
    timestamp: Date.now(),
    features: {
      average: 0,
      peak: 0,
      peakFrequency: 0,
      centroid: 0,
      bass: 0,
      lowMid: 0,
      mid: 0,
      highMid: 0,
      treble: 0,
      isPlaying: false,
      isSilent: true,
      bassToTrebleRatio: 'N/A',
      brightness: 'dark'
    }
  },

  playing: {
    connected: true,
    timestamp: Date.now(),
    features: {
      average: 50,
      peak: 100,
      peakFrequency: 440,
      centroid: 250,
      bass: 60,
      lowMid: 50,
      mid: 40,
      highMid: 30,
      treble: 20,
      isPlaying: true,
      isSilent: false,
      bassToTrebleRatio: '3.00',
      brightness: 'balanced'
    }
  },

  bassHeavy: {
    connected: true,
    timestamp: Date.now(),
    features: {
      average: 60,
      peak: 120,
      peakFrequency: 80,
      centroid: 150,
      bass: 100,
      lowMid: 60,
      mid: 30,
      highMid: 10,
      treble: 5,
      isPlaying: true,
      isSilent: false,
      bassToTrebleRatio: '20.00',
      brightness: 'dark'
    }
  },

  bright: {
    connected: true,
    timestamp: Date.now(),
    features: {
      average: 55,
      peak: 110,
      peakFrequency: 8000,
      centroid: 600,
      bass: 20,
      lowMid: 30,
      mid: 50,
      highMid: 70,
      treble: 90,
      isPlaying: true,
      isSilent: false,
      bassToTrebleRatio: '0.22',
      brightness: 'bright'
    }
  }
};

export const mcpRequests = {
  listTools: {
    jsonrpc: '2.0',
    method: 'tools/list',
    id: 1
  },

  callInit: {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'init',
      arguments: {}
    },
    id: 2
  },

  callWrite: (pattern: string) => ({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'edit_pattern',
      arguments: { mode: 'write', pattern }
    },
    id: 3
  }),

  callPlay: {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'playback',
      arguments: { action: 'play' }
    },
    id: 4
  },

  callGeneratePattern: (style: string, key: string, bpm: number) => ({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'compose',
      arguments: { style, key, tempo: bpm }
    },
    id: 5
  }),

  callSave: (name: string, tags: string[]) => ({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'pattern_store',
      arguments: { action: 'save', name, tags }
    },
    id: 6
  })
};

export const errorScenarios = {
  networkTimeout: {
    name: 'NetworkTimeout',
    message: 'Navigation timeout of 10000 ms exceeded',
    type: 'TimeoutError'
  },

  selectorNotFound: {
    name: 'SelectorNotFound',
    message: 'Selector .cm-content not found',
    type: 'TimeoutError'
  },

  notInitialized: {
    name: 'NotInitialized',
    message: 'Not initialized',
    type: 'Error'
  },

  invalidPattern: {
    name: 'InvalidPattern',
    message: 'Pattern validation failed',
    type: 'ValidationError'
  },

  fileNotFound: {
    name: 'FileNotFound',
    message: 'Pattern file not found',
    type: 'Error'
  }
};

export const performanceMetrics = {
  fast: {
    initTime: 1000,
    writeTime: 50,
    playTime: 100,
    analyzeTime: 30
  },

  slow: {
    initTime: 5000,
    writeTime: 500,
    playTime: 1000,
    analyzeTime: 200
  },

  threshold: {
    init: 3000,
    write: 200,
    play: 500,
    analyze: 100
  }
};

export function createTestPattern(
  type: keyof typeof samplePatterns,
  modifications?: Partial<{ prefix: string; suffix: string; gain: number }>
): string {
  let pattern = samplePatterns[type];

  if (modifications?.prefix) {
    pattern = modifications.prefix + '\n' + pattern;
  }

  if (modifications?.gain) {
    pattern += `.gain(${modifications.gain})`;
  }

  if (modifications?.suffix) {
    pattern += '\n' + modifications.suffix;
  }

  return pattern;
}

export function createTestPatternData(overrides?: any) {
  return {
    name: 'test-pattern',
    content: samplePatterns.simple,
    tags: ['test'],
    timestamp: new Date().toISOString(),
    audioFeatures: audioFeatures.silent,
    ...overrides
  };
}

export async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function generateRandomPattern(): string {
  const sounds = ['bd', 'cp', 'hh', 'oh', 'sn'];
  const patterns = ['*4', '*8', '~ ~ ~', '[~ ~]*2'];
  const sound = sounds[Math.floor(Math.random() * sounds.length)];
  const pattern = patterns[Math.floor(Math.random() * patterns.length)];
  return `s("${sound}${pattern}")`;
}
