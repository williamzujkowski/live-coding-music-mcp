/**
 * Type declarations for Strudel packages
 * These packages don't ship with TypeScript types
 */

declare module '@strudel/core' {
  export function pure(value: any): any;
  export function hap(part: any, whole: any, value: any): any;
  export const Pattern: any;
  export function reify(pattern: any): any;
  export function silence(): any;
  export function register(name: string, fn: (...args: unknown[]) => unknown): void;
  export function queryArc(begin: number, end: number): any[];
  export class Hap {
    part: { begin: { valueOf: () => number }; end: { valueOf: () => number } };
    value: any;
    constructor(part: any, whole: any, value: any);
  }
}

declare module '@strudel/mini' {
  export function mini(input: string | TemplateStringsArray, ...args: any[]): any;
}

declare module '@strudel/transpiler' {
  export interface TranspilerResult {
    output: string;
    locations?: Array<{ start: number; end: number; value: string }>;
  }
  export function transpiler(code: string): TranspilerResult;
}
