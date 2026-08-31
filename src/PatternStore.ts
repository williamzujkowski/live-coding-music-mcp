import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { Logger } from './utils/Logger.js';
import { ValidationError } from './utils/CategorisedError.js';

/**
 * Narrows a parsed JSON value to a pattern, or null when it is not one.
 *
 * `JSON.parse(data) as PatternData` is a cast: it asserts a shape rather
 * than checking it, so a file that parses but lacks `tags` or
 * `timestamp` threw further downstream and took the whole listing with
 * it (#426).
 */
function asPatternData(value: unknown): PatternData | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== 'string') return null;
  if (typeof candidate.content !== 'string') return null;
  if (typeof candidate.timestamp !== 'string') return null;
  if (!Array.isArray(candidate.tags)) return null;
  return candidate as unknown as PatternData;
}

interface PatternData {
  name: string;
  content: string;
  tags: string[];
  timestamp: string;
  audioFeatures?: any;
}

export class PatternStore {
  private patternCache: Map<string, PatternData> = new Map();
  private listCache: { patterns: PatternData[], timestamp: number, skipped: number } | null = null;
  /** Set by the read `listDetailed` wraps; never read except through it. */
  private skippedInLastRead = 0;
  private readonly LIST_CACHE_TTL = 5000; // 5 seconds
  private readonly MAX_CACHE_SIZE = 100; // LRU cache limit
  private directoryEnsured: boolean = false;
  private logger: Logger;

  constructor(private basePath: string) {
    this.logger = new Logger();
    this.ensureDirectory();
  }

  /**
   * Sets a value in the cache with LRU eviction
   * Maintains max cache size by evicting oldest entries
   */
  private setCacheWithLRU(name: string, data: PatternData): void {
    // If already exists, delete first to update insertion order (LRU)
    if (this.patternCache.has(name)) {
      this.patternCache.delete(name);
    }

    // Evict oldest entries if at capacity
    while (this.patternCache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.patternCache.keys().next().value;
      if (oldestKey) {
        this.patternCache.delete(oldestKey);
      }
    }

    this.patternCache.set(name, data);
  }

  /**
   * Gets a value from cache and updates its LRU position
   */
  private getCacheWithLRU(name: string): PatternData | undefined {
    const data = this.patternCache.get(name);
    if (data) {
      // Move to end (most recently used)
      this.patternCache.delete(name);
      this.patternCache.set(name, data);
    }
    return data;
  }

  private async ensureDirectory() {
    if (this.directoryEnsured) return;

    try {
      await fs.mkdir(this.basePath, { recursive: true });
      this.directoryEnsured = true;
    } catch (error) {
      console.error('Failed to create patterns directory:', error);
    }
  }

  /**
   * Writes a pattern, refusing to silently destroy a different one.
   *
   * `sanitizeFilename` is many-to-one and always has been: `Track 1`,
   * `TRACK 1` and `Track#1` all land on `track_1.json`, `drums/kick` and
   * `synth/kick` both land on `kick.json`, and any two all-non-ASCII
   * names collapse together. That mapping stays — names with spaces and
   * capitals are natural for music, and rejecting them would break every
   * pattern already saved.
   *
   * What changes is that a collision is no longer silent. Measured
   * before this guard:
   *
   *     save("My-Jam", "VERSION-ONE"); save("my-jam", "VERSION-TWO")
   *     -> one file, VERSION-ONE gone, both saves reported success
   *
   * Re-saving under the SAME original name is an ordinary update and is
   * not a collision — refusing that would break every edit of an
   * existing pattern.
   *
   * @param name - Pattern name as the caller spells it
   * @param content - Pattern source
   * @param tags - Tags to attach
   * @param options.overwrite - Replace a different pattern on the same
   *   filename. Deliberately explicit: the loss is not recoverable.
   * @throws {ValidationError} When the filename is taken by a pattern
   *   saved under a different name and `overwrite` is not set
   */
  async save(
    name: string,
    content: string,
    tags: string[] = [],
    options: { overwrite?: boolean } = {},
  ): Promise<void> {
    await this.ensureDirectory();

    const filename = this.sanitizeFilename(name) + '.json';
    const filepath = path.join(this.basePath, filename);
    // One file, one cache entry. See the note on setCacheWithLRU below.
    const cacheKey = this.sanitizeFilename(name);

    if (options.overwrite !== true) {
      const existing = await this.readIfPresent(filepath);
      if (existing !== null && existing.name !== name) {
        throw new ValidationError(
          `Cannot save "${name}": the name "${existing.name}" already uses the file ` +
          `${filename}. Names are lowercased and stripped of punctuation, so these ` +
          `collide. Choose a name that differs by more than case or punctuation, or ` +
          `pass overwrite: true to replace "${existing.name}" — which cannot be undone.`
        );
      }
    }

    const data: PatternData = {
      name,
      content,
      tags,
      timestamp: new Date().toISOString(),
    };

    // Write first, cache second.
    //
    // The cache used to be written before the file, so a rejected write
    // left a pattern cached that was never persisted and `load` served
    // it as though it had been. A 255-character name reaches here — it
    // passes InputValidator's 255 limit and `sanitizeFilename` measures
    // the stem without `.json` — and then fails ENAMETOOLONG on the
    // 260-byte component (#428).
    // Write to a temp file, then rename.
    //
    // `rename` is atomic within a filesystem, so a reader sees either
    // the old pattern or the new one and never a half-written file. The
    // direct write left truncated JSON behind on a crash or a full disk
    // — which is exactly the input that used to take the entire listing
    // down (#426). That fix made the listing survive such a file; this
    // one stops producing them.
    //
    // The temp name is random, and the write is exclusive.
    //
    // A predictable name (pid plus a counter) is guessable, so anyone
    // able to write into the pattern directory could pre-create it as a
    // symlink and redirect the write elsewhere — CodeQL flags exactly
    // this as js/insecure-temporary-file, and it was right. `randomBytes`
    // removes the guess and the `wx` flag refuses to open a path that
    // already exists, symlink included, rather than following it.
    //
    // It sits in the same directory so the rename stays within one
    // filesystem, which is what makes the rename atomic.
    const tempPath = `${filepath}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), { flag: 'wx' });
      await fs.rename(tempPath, filepath);
    } catch (error) {
      // Leaving a stray .tmp would make it the next listing's problem.
      await fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }

    // Keyed by the FILE's name, not the caller's.
    //
    // The cache was keyed by the raw name while the file is keyed by the
    // sanitized one, so two names that sanitize alike had one file and
    // two cache entries. Measured:
    //
    //   save("My-Jam", "VERSION-ONE"); save("my-jam", "VERSION-TWO")
    //   files on disk: ["my-jam.json"]  disk content: VERSION-TWO
    //   load("My-Jam") -> VERSION-ONE   load("my-jam") -> VERSION-TWO
    //
    // Two answers for one file, and the stale one never expires — this
    // cache has no TTL.
    this.setCacheWithLRU(cacheKey, data);
    this.listCache = null; // Invalidate list cache
  }

  /**
   * The pattern in a file, or null when it is absent or unreadable.
   *
   * An unreadable file is treated as absent on purpose: refusing a save
   * because something in the directory cannot be parsed would make one
   * corrupt file block writes, which is the mistake #426 fixed for
   * reads.
   */
  private async readIfPresent(filepath: string): Promise<PatternData | null> {
    try {
      return asPatternData(JSON.parse(await fs.readFile(filepath, 'utf-8')));
    } catch {
      return null;
    }
  }

  async load(name: string): Promise<PatternData | null> {
    // Keyed by the file, not the caller's spelling of it (#428).
    const cacheKey = this.sanitizeFilename(name);

    // Check cache first with LRU update
    const cached = this.getCacheWithLRU(cacheKey);
    if (cached) {
      return cached;
    }

    const filename = cacheKey + '.json';
    const filepath = path.join(this.basePath, filename);

    try {
      const data = await fs.readFile(filepath, 'utf-8');
      const pattern = JSON.parse(data);

      // Update cache with LRU eviction
      this.setCacheWithLRU(cacheKey, pattern);

      return pattern;
    } catch (error) {
      this.logger.warn(`Failed to load pattern: ${name}`, error);
      return null;
    }
  }

  /**
   * Patterns, plus how many files could not be read.
   *
   * The count travels WITH the data rather than sitting on the instance:
   * a `getLastSkipped()` would belong to whichever listing finished most
   * recently, and two concurrent calls would cross their answers.
   *
   * A partial listing presented as complete is the same lie as reporting
   * zero, quieter — the store logs what it skipped and no MCP client
   * reads the log (#426; #335 is the precedent for making a warning
   * reach the caller).
   */
  async listDetailed(tag?: string): Promise<{ patterns: PatternData[]; skipped: number }> {
    const patterns = await this.list(tag);
    return { patterns, skipped: this.skippedInLastRead };
  }

  async list(tag?: string): Promise<PatternData[]> {
    // Use cached list if available and not expired
    const now = Date.now();
    if (!tag && this.listCache && (now - this.listCache.timestamp) < this.LIST_CACHE_TTL) {
      // The cached listing carries its own skipped count, so a cache hit
      // does not inherit the previous uncached read's.
      this.skippedInLastRead = this.listCache.skipped;
      return this.listCache.patterns;
    }

    try {
      await this.ensureDirectory();
      const files = await fs.readdir(this.basePath);

      // Parallel file reading for better performance.
      //
      // `allSettled`, not `all`. Fail-fast meant one truncated or
      // unparseable `.json` rejected the whole batch, the catch below
      // returned `[]`, and `doList` reported that as the success "No
      // patterns found" — measured, five saved patterns plus one
      // truncated file listed as zero (#426). A hundred patterns and one
      // bad file told the user they had none.
      const results = await Promise.allSettled(
        files
          .filter(file => file.endsWith('.json'))
          .map(async (file) => {
            const filepath = path.join(this.basePath, file);
            const data = await fs.readFile(filepath, 'utf-8');
            return { file, parsed: JSON.parse(data) as unknown };
          })
      );

      const allPatterns: PatternData[] = [];
      const skipped: string[] = [];
      for (const result of results) {
        if (result.status !== 'fulfilled') {
          skipped.push('unreadable');
          continue;
        }
        // A cast is not a check. A file missing `timestamp` threw in the
        // sort below and one missing `tags` threw in the tag filter —
        // each taking the entire listing down the same way a truncated
        // file did.
        const pattern = asPatternData(result.value.parsed);
        if (pattern === null) {
          skipped.push(result.value.file);
          continue;
        }
        allPatterns.push(pattern);
      }
      this.skippedInLastRead = skipped.length;
      if (skipped.length > 0) {
        this.logger.warn(
          `Skipped ${String(skipped.length)} unreadable or malformed pattern file(s)`,
          { skipped }
        );
      }

      // Filter and sort
      const filteredPatterns = tag
        ? allPatterns.filter(p => p.tags.includes(tag))
        : allPatterns;

      const sorted = filteredPatterns.sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp)
      );

      // Update cache only for non-filtered lists
      if (!tag) {
        this.listCache = { patterns: sorted, timestamp: now, skipped: skipped.length };
      }

      return sorted;
    } catch (error) {
      this.logger.warn(`Failed to list patterns${tag ? ` with tag: ${tag}` : ''}`, error);
      return [];
    }
  }

  // Clear cache method
  clearCache() {
    this.patternCache.clear();
    this.listCache = null;
  }

  /**
   * Returns cache statistics for monitoring
   */
  getCacheStats(): { size: number; maxSize: number; listCacheValid: boolean } {
    return {
      size: this.patternCache.size,
      maxSize: this.MAX_CACHE_SIZE,
      listCacheValid: this.listCache !== null &&
        (Date.now() - this.listCache.timestamp) < this.LIST_CACHE_TTL
    };
  }

  /**
   * Sanitizes a pattern name to create a safe filename
   * Prevents path traversal attacks and ensures cross-platform compatibility
   * @param name - The pattern name to sanitize
   * @returns A safe filename without extension
   * @throws Error if the name is invalid or uses reserved names
   */
  private sanitizeFilename(name: string): string {
    // Use path.basename to prevent path traversal attacks
    const baseName = path.basename(name);

    // Remove dangerous characters and normalize
    const cleaned = baseName
      .replace(/[^a-z0-9_-]/gi, '_')
      .toLowerCase();

    // Validate length
    if (cleaned.length === 0 || cleaned.length > 255) {
      throw new ValidationError('Pattern name must be between 1 and 255 characters');
    }

    // Prevent reserved filenames on Windows
    const reserved = ['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'];
    if (reserved.includes(cleaned.toLowerCase())) {
      throw new ValidationError('Pattern name uses a reserved filename');
    }

    return cleaned;
  }
}