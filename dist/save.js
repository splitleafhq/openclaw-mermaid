import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FsSafeError, root } from 'openclaw/plugin-sdk/security-runtime';
/** Lowercase `[a-z0-9-]`, at most 40 characters, never empty and never a path. */
export function slugify(name) {
    const slug = name
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/^-+|-+$/g, '')
        .slice(0, 40)
        .replaceAll(/-+$/g, '');
    return slug === '' ? 'diagram' : slug;
}
const pad = (n) => String(n).padStart(2, '0');
/** UTC, so the name doesn't depend on the gateway's time zone. */
export function stamp(date) {
    const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    return `${day}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}
function reason(error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    return typeof code === 'string' ? `saving failed (${code})` : 'saving failed';
}
/**
 * Creates the file through OpenClaw's `root().create` with `atomic`, which never replaces an existing entry, a
 * symlink included. Returns false when the name is taken.
 */
async function create(dir, name, data) {
    try {
        await (await root(dir)).create(name, data, { atomic: true, mode: 0o644 });
        return true;
    }
    catch (error) {
        if (error instanceof FsSafeError && (error.code === 'already-exists' || error.code === 'path-alias')) {
            return false;
        }
        throw error;
    }
}
/** Saves `<base>.mmd` and `<base>.png` in `dir`. The base is built here from the clock, a random suffix and the slug. */
export async function saveDiagram(dir, name, source, png, options = {}) {
    const slug = slugify(name);
    const now = options.now ?? (() => new Date());
    const hex = options.hex ?? (() => randomBytes(3).toString('hex'));
    const attempt = async (left) => {
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
    }
    catch (error) {
        return { ok: false, message: reason(error) };
    }
}
