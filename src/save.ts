import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { FsSafeError, root } from 'openclaw/plugin-sdk/security-runtime';

export type SaveResult = { ok: true; base: string; mmdPath: string; pngPath: string } | { ok: false; message: string };

export interface SaveOptions {
  now?: () => Date;
  hex?: () => string;
}

/** Lowercase `[a-z0-9-]`, at most 40 characters, never empty and never a path. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40)
    .replaceAll(/-+$/g, '');
  return slug === '' ? 'diagram' : slug;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** UTC, so the name doesn't depend on the gateway's time zone. */
export function stamp(date: Date): string {
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return `${day}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function reason(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' ? `saving failed (${code})` : 'saving failed';
}

/**
 * Creates the file through OpenClaw's `root().create` with `atomic`, which never replaces an existing entry, a
 * symlink included. Returns false when the name is taken.
 */
async function create(dir: string, name: string, data: string | Buffer): Promise<boolean> {
  try {
    await (await root(dir)).create(name, data, { atomic: true, mode: 0o644 });
    return true;
  } catch (error) {
    if (error instanceof FsSafeError && (error.code === 'already-exists' || error.code === 'path-alias')) {
      return false;
    }
    throw error;
  }
}

/** Saves `<base>.mmd` and `<base>.png` in `dir`. The base is built here from the clock, a random suffix and the slug. */
export async function saveDiagram(dir: string, name: string, source: string, png: Buffer, options: SaveOptions = {}): Promise<SaveResult> {
  const slug = slugify(name);
  const now = options.now ?? (() => new Date());
  const hex = options.hex ?? (() => randomBytes(3).toString('hex'));
  const attempt = async (left: number): Promise<SaveResult> => {
    if (left === 0) {
      return { ok: false, message: 'could not pick an unused file name' };
    }
    const base = `${stamp(now())}-${hex()}-${slug}`;
    if (!(await create(dir, `${base}.mmd`, source))) {
      return attempt(left - 1);
    }
    if (!(await create(dir, `${base}.png`, png))) {
      return { ok: false, message: `${base}.png already exists` };
    }
    return { ok: true, base, mmdPath: join(dir, `${base}.mmd`), pngPath: join(dir, `${base}.png`) };
  };
  try {
    await mkdir(dir, { recursive: true, mode: 0o755 });
    return await attempt(5);
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
}

/** The `.mmd` names `saveDiagram` creates. Anything else is refused, so a caller can't name another file. */
const SAVED_MMD = /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}-[a-z0-9-]{1,40}\.mmd$/;

export type ReadResult = { ok: true; base: string; source: string } | { ok: false; message: string };

/** Reads a `.mmd` this plugin saved in `dir`, given the name or the path `render_mermaid` returned. */
export async function readSavedSource(dir: string, file: string): Promise<ReadResult> {
  const name = basename(file.trim());
  if (!SAVED_MMD.test(name)) {
    return { ok: false, message: 'file must be the .mmd path render_mermaid returned' };
  }
  try {
    const source = await (await root(dir)).readText(name);
    return { ok: true, base: name.slice(0, -'.mmd'.length), source };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    return { ok: false, message: code === 'ENOENT' || code === 'not-found' ? `${name} is not in the diagrams folder` : reason(error) };
  }
}
