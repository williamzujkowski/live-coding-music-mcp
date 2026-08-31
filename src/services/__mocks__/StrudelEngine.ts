/**
 * Mock StrudelEngine for Jest testing
 * Provides stub implementations for tests that don't need actual Strudel execution
 */

import { declaredBpm } from '../../utils/Tempo.js';

export interface TranspileResult {
  success: boolean;
  transpiledCode?: string;
  error?: string;
  errorLocation?: {
    line: number;
    column: number;
    offset: number;
  };
  locations?: Array<{
    start: number;
    end: number;
    value?: string;
    name?: string;
  }>;
}

export interface LocalValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
  errorLocation?: {
    line: number;
    column: number;
  };
}

export interface PatternEvent {
  value: any;
  start: number;
  end: number;
  isWhole: boolean;
  context?: Record<string, any>;
}

export interface PatternMetadata {
  eventsPerCycle: number;
  uniqueValues: string[];
  usesSound: boolean;
  usesNote: boolean;
  isStack: boolean;
  functionsUsed: string[];
  complexity: number;
  bpm?: number;
}

export class StrudelEngine {
  transpile(code: string): TranspileResult {
    if (!code || code.trim().length === 0) {
      return {
        success: false,
        error: 'Empty pattern',
        errorLocation: { line: 1, column: 1, offset: 0 },
      };
    }

    // Simple validation - check for basic syntax issues
    if (code.includes('(') && !code.includes(')')) {
      return {
        success: false,
        error: 'Unexpected end of input',
        errorLocation: { line: 1, column: code.length, offset: code.length },
      };
    }

    return {
      success: true,
      transpiledCode: `return /* mock transpiled */ ${code};`,
      locations: [],
    };
  }

  validate(code: string): LocalValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    if (!code || code.trim().length === 0) {
      return {
        valid: false,
        errors: ['Pattern is empty'],
        warnings: [],
        suggestions: ['Add a pattern like: s("bd hh sd hh")'],
      };
    }

    const transpileResult = this.transpile(code);
    if (!transpileResult.success) {
      return {
        valid: false,
        errors: [transpileResult.error || 'Syntax error'],
        warnings,
        suggestions: ['Check pattern syntax'],
        errorLocation: transpileResult.errorLocation
          ? { line: transpileResult.errorLocation.line, column: transpileResult.errorLocation.column }
          : undefined,
      };
    }

    // Check for common issues
    const gainMatches = code.match(/\.gain\s*\(\s*(\d+(?:\.\d+)?)\s*\)/g);
    if (gainMatches) {
      for (const match of gainMatches) {
        const value = parseFloat(match.match(/(\d+(?:\.\d+)?)/)?.[1] || '0');
        if (value > 2) {
          warnings.push(`High gain value (${value}) may cause distortion`);
        }
      }
    }

    if (!/setcpm|setbpm|cpm|bpm/.test(code)) {
      suggestions.push('Consider setting tempo with setcpm(120)');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  queryEvents(code: string, start: number, end: number): PatternEvent[] {
    const transpileResult = this.transpile(code);
    if (!transpileResult.success) {
      throw new Error(`Transpilation failed: ${transpileResult.error}`);
    }

    // Return mock events based on pattern content
    const events: PatternEvent[] = [];
    const cycles = end - start;

    // Simple mock - return 4 events per cycle for patterns containing s()
    if (code.includes('s(')) {
      const matches = code.match(/s\("([^"]+)"\)/);
      if (matches) {
        const sounds = matches[1].split(' ');
        const eventsPerCycle = sounds.length;
        const duration = 1 / eventsPerCycle;

        for (let cycle = 0; cycle < cycles; cycle++) {
          for (let i = 0; i < sounds.length; i++) {
            events.push({
              value: { s: sounds[i] },
              start: start + cycle + i * duration,
              end: start + cycle + (i + 1) * duration,
              isWhole: true,
            });
          }
        }
      }
    }

    return events;
  }

  compile(code: string): any {
    const transpileResult = this.transpile(code);
    if (!transpileResult.success) {
      throw new Error(`Transpilation failed: ${transpileResult.error}`);
    }

    return {
      queryArc: (start: number, end: number) => this.queryEvents(code, start, end),
    };
  }

  analyzePattern(code: string): PatternMetadata {
    const metadata: PatternMetadata = {
      eventsPerCycle: 0,
      uniqueValues: [],
      usesSound: false,
      usesNote: false,
      isStack: false,
      functionsUsed: [],
      complexity: 0,
    };

    // The real parser, not a copy of it. This mock carried its own
    // bare-literal regex, so StrudelEngine's tests were asserting the
    // mock's idea of a tempo call rather than the shipped one (#397).
    const bpm = declaredBpm(code);
    if (bpm !== undefined) {
      metadata.bpm = bpm;
    }

    metadata.usesSound = /\bs\s*\(/.test(code) || /\bsound\s*\(/.test(code);
    metadata.usesNote = /\bnote\s*\(/.test(code);
    metadata.isStack = /\bstack\s*\(/.test(code);

    // Extract function names
    const funcMatches = code.match(/\b([a-z][a-zA-Z0-9_]*)\s*\(/g);
    if (funcMatches) {
      const funcNames = funcMatches.map(m => m.replace(/\s*\($/, ''));
      metadata.functionsUsed = [...new Set(funcNames)];
    }

    try {
      const events = this.queryEvents(code, 0, 1);
      metadata.eventsPerCycle = events.length;

      const values = events.map(e => {
        if (typeof e.value === 'object' && e.value !== null) {
          return e.value.s || e.value.note || e.value.n || JSON.stringify(e.value);
        }
        return String(e.value);
      });
      metadata.uniqueValues = [...new Set(values)];

      metadata.complexity = Math.min(
        (events.length / 16) * 0.3 +
        (metadata.uniqueValues.length / 8) * 0.2 +
        (metadata.functionsUsed.length / 10) * 0.3 +
        (metadata.isStack ? 0.1 : 0) +
        (code.length / 500) * 0.1,
        1
      );
    } catch {
      metadata.complexity = Math.min(
        (metadata.functionsUsed.length / 10) * 0.5 +
        (code.length / 500) * 0.3 +
        (metadata.isStack ? 0.2 : 0),
        1
      );
    }

    return metadata;
  }
}
