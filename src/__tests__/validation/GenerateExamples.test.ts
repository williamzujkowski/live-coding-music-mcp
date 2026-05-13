import { PatternGenerator } from '../../services/PatternGenerator';
import { MusicTheory } from '../../services/MusicTheory';
import { PatternValidator } from '../../utils/PatternValidator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Generate Example Patterns', () => {
  let generator: PatternGenerator;
  let theory: MusicTheory;
  let validator: PatternValidator;
  // Write to a temp dir — tracked fixtures in patterns/examples/ must not be
  // mutated by every test run (was producing 14-file timestamp churn).
  let examplesDir: string;

  beforeAll(() => {
    examplesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strudel-examples-'));
  });

  afterAll(() => {
    fs.rmSync(examplesDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    theory = new MusicTheory();
    generator = new PatternGenerator(theory);
    validator = new PatternValidator();
  });

  const examples = [
    // Techno
    { genre: 'techno', name: 'hard-techno', key: 'A', bpm: 135, description: 'Hard driving techno with acid bassline' },
    { genre: 'techno', name: 'minimal-techno', key: 'E', bpm: 128, description: 'Minimal techno with subtle groove' },

    // House
    { genre: 'house', name: 'deep-house', key: 'D', bpm: 122, description: 'Deep house with soulful chords' },
    { genre: 'house', name: 'tech-house', key: 'A', bpm: 126, description: 'Tech house with hypnotic groove' },

    // Drum & Bass
    { genre: 'dnb', name: 'liquid-dnb', key: 'C', bpm: 174, description: 'Liquid drum & bass with atmospheric pads' },
    { genre: 'dnb', name: 'neurofunk', key: 'F#', bpm: 176, description: 'Dark neurofunk with heavy bass' },

    // Ambient
    { genre: 'ambient', name: 'dark-ambient', key: 'C', bpm: 70, description: 'Dark atmospheric ambient' },
    { genre: 'ambient', name: 'drone', key: 'G', bpm: 60, description: 'Minimalist drone ambient' },

    // Trap
    { genre: 'trap', name: 'modern-trap', key: 'F#', bpm: 140, description: 'Modern trap with 808 bass' },
    { genre: 'trap', name: 'cloud-trap', key: 'B', bpm: 135, description: 'Cloud trap with ethereal atmosphere' },

    // Jungle
    { genre: 'jungle', name: 'classic-jungle', key: 'G', bpm: 165, description: 'Classic jungle with chopped breaks' },
    { genre: 'jungle', name: 'ragga-jungle', key: 'D', bpm: 170, description: 'Ragga jungle with reggae influence' },

    // Jazz
    { genre: 'jazz', name: 'bebop', key: 'A#', bpm: 180, description: 'Fast bebop with complex chords' },
    { genre: 'jazz', name: 'modal-jazz', key: 'D', bpm: 120, description: 'Modal jazz with extended harmonies' },
  ];

  examples.forEach(({ genre, name, key, bpm, description }) => {
    it(`should generate and save ${genre} example: ${name}`, () => {
      const pattern = generator.generateCompletePattern(genre, key, bpm);

      // Validate pattern
      const validation = validator.validate(pattern);
      expect(validation.valid).toBe(true);

      // Create example object
      const example = {
        name,
        genre,
        pattern,
        bpm,
        key,
        description,
        tags: [genre, name.split('-').join(' ')],
        timestamp: new Date().toISOString(),
      };

      // Ensure genre directory exists
      const genreDir = path.join(examplesDir, genre);
      if (!fs.existsSync(genreDir)) {
        fs.mkdirSync(genreDir, { recursive: true });
      }

      // Save to file
      const filePath = path.join(genreDir, `${name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(example, null, 2));

      // Verify file was created
      expect(fs.existsSync(filePath)).toBe(true);

      // Verify can be loaded back
      const loaded = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(loaded.pattern).toBe(pattern);
      expect(loaded.bpm).toBe(bpm);
      expect(loaded.key).toBe(key);
    });
  });

  it('should have created all example files', () => {
    const genreCounts: Record<string, number> = {};

    examples.forEach(({ genre }) => {
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    });

    Object.entries(genreCounts).forEach(([genre, expectedCount]) => {
      const genreDir = path.join(examplesDir, genre);
      const files = fs.readdirSync(genreDir).filter(f => f.endsWith('.json'));

      expect(files.length).toBeGreaterThanOrEqual(expectedCount);
    });
  });
});
