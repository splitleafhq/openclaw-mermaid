export const PLUGIN_ID = 'mermaid';

export type SourceMode = 'onRequest' | 'always';
export type TextPosition = 'after' | 'before';

export interface MermaidConfig {
  saveDir?: string;
  timeoutMs: number;
  maxSourceChars: number;
  source: SourceMode;
  textPosition: TextPosition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function count(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

/** The manifest schema rejects bad shapes; these fallbacks cover a config that never went through it. */
export function resolveConfig(raw: unknown): MermaidConfig {
  const c = isRecord(raw) ? raw : {};
  return {
    saveDir: text(c.saveDir),
    timeoutMs: count(c.timeoutMs, 20000),
    maxSourceChars: count(c.maxSourceChars, 20000),
    source: c.source === 'always' ? 'always' : 'onRequest',
    textPosition: c.textPosition === 'before' ? 'before' : 'after',
  };
}
