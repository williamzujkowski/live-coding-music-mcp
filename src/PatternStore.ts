import { promises as fs } from 'fs';
import * as path from 'path';
import { Logger } from './utils/Logger.js';

interface PatternData {
  name: string;
  content: string;
  tags: string[];
  timestamp: string;
  audioFeatures?: any;
}

export class PatternStore {
  private patternCache: Map<string, PatternData> = new Map();
  private listCache: { patterns: PatternData[], timestamp: number } | null = null;
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

  async save(name: string, content: string, tags: string[] = []): Promise<void> {
    await this.ensureDirectory();

    const filename = this.sanitizeFilename(name) + '.json';
    const filepath = path.join(this.basePath, filename);

    const data: PatternData = {
      name,
      content,
      tags,
      timestamp: new Date().toISOString(),
    };

    // Update cache with LRU eviction
    this.setCacheWithLRU(name, data);
    this.listCache = null; // Invalidate list cache

    // Write file asynchronously
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  }

  async load(name: string): Promise<PatternData | null> {
    // Check cache first with LRU update
    const cached = this.getCacheWithLRU(name);
    if (cached) {
      return cached;
    }

    const filename = this.sanitizeFilename(name) + '.json';
    const filepath = path.join(this.basePath, filename);

    try {
      const data = await fs.readFile(filepath, 'utf-8');
      const pattern = JSON.parse(data);

      // Update cache with LRU eviction
      this.setCacheWithLRU(name, pattern);

      return pattern;
    } catch (error) {
      this.logger.warn(`Failed to load pattern: ${name}`, error);
      return null;
    }
  }

  async list(tag?: string): Promise<PatternData[]> {
    // Use cached list if available and not expired
    const now = Date.now();
    if (!tag && this.listCache && (now - this.listCache.timestamp) < this.LIST_CACHE_TTL) {
      return this.listCache.patterns;
    }

    try {
      const files = await fs.readdir(this.basePath);

      // Parallel file reading for better performance
      const readPromises = files
        .filter(file => file.endsWith('.json'))
        .map(async (file) => {
          const filepath = path.join(this.basePath, file);
          const data = await fs.readFile(filepath, 'utf-8');
          return JSON.parse(data) as PatternData;
        });

      const allPatterns = await Promise.all(readPromises);

      // Filter and sort
      const filteredPatterns = tag
        ? allPatterns.filter(p => p.tags.includes(tag))
        : allPatterns;

      const sorted = filteredPatterns.sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp)
      );

      // Update cache only for non-filtered lists
      if (!tag) {
        this.listCache = { patterns: sorted, timestamp: now };
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
      throw new Error('Pattern name must be between 1 and 255 characters');
    }

    // Prevent reserved filenames on Windows
    const reserved = ['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'];
    if (reserved.includes(cleaned.toLowerCase())) {
      throw new Error('Pattern name uses a reserved filename');
    }

    return cleaned;
  }
}