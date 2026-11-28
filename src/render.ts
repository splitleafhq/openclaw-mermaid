import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** `host` marks a failure the source can't fix: the gateway host needs a change. */
export type RenderResult = { ok: true; png: Buffer } | { ok: false; message: string; host?: true };

export interface RenderOptions {
  timeoutMs: number;
  /** The mermaid-cli executable. Tests point it at a stand-in. */
  command?: string;
  signal?: AbortSignal;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** OpenClaw's media store refuses larger files (`MEDIA_MAX_BYTES`, openclaw 2026.10.8 `dist/store-*.mjs`). */
export const MAX_PNG_BYTES = 5 * 1024 * 1024;

/** `src/` and `dist/` both sit one level below `assets/`. */
const asset = (name: string) => fileURLToPath(new URL(`../assets/${name}`, import.meta.url));

/**
 * mermaid-cli prints the parse error first, then a browser stack trace. Keeps the error, drops the trace, and caps
 * the length so the agent gets something it can fix.
 */
export function parseError(stderr: string): string {
  const lines: string[] = [];
  for (const line of stderr.split('\n')) {
    if (/^\s+at |\((?:https?|file):\/\//.test(line)) {
      break;
    }
    if (line.trim() !== '') {
      lines.push(line.trimEnd());
    }
  }
  const message = lines.join('\n').replace(/^Error: /, '').slice(0, 1000);
  return message === '' ? 'mermaid-cli failed without an error message' : message;
}

/**
 * Renders Mermaid source to PNG with mermaid-cli, reading the source on stdin and the PNG on stdout. mermaid-cli runs
 * headless Chrome from a `file:` page, which at `securityLevel: strict` still loads image URLs and local paths a label
 * names. `assets/puppeteer.json` makes every host name fail to resolve, and the DOMPurify config in
 * `assets/mermaid.json` drops the tags and attributes that load files. The process runs in its own group so a timeout
 * also stops Chrome.
 */
/** Puppeteer's text when the browser version it was built for is not installed (puppeteer-core 25.16.0 `BrowserLauncher.js`). */
const MISSING_BROWSER = /Could not find (\S+) \(ver\. ([^)\s]+)\)/;

/** Names the failures that come from the gateway host, so the agent stops retrying a source that is fine. */
function hostFailure(stderr: string): string | undefined {
  const missing = MISSING_BROWSER.exec(stderr);
  if (missing === null) {
    return undefined;
  }
  const [, browser = '', version = ''] = missing;
  return `mermaid-cli's browser, ${browser} ${version}, is not installed on the gateway host. From mermaid-cli's install folder, so its own puppeteer and cache are used, run \`npx puppeteer browsers install ${browser.toLowerCase()}@${version}\``;
}

export function renderPng(source: string, options: RenderOptions): Promise<RenderResult> {
  const args = ['-q', '-i', '-', '-o', '-', '-e', 'png', '-b', 'white', '-s', '2'];
  args.push('-c', asset('mermaid.json'), '-p', asset('puppeteer.json'));
  if (options.signal?.aborted) {
    return Promise.resolve({ ok: false, message: 'the call was cancelled' });
  }
  return new Promise((resolve) => {
    const child = spawn(options.command ?? 'mmdc', args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let outBytes = 0;
    let stderr = '';
    let failure: string | undefined;
    const stop = (message: string) => {
      failure ??= message;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // The group is already gone.
        }
      }
    };
    const timer = setTimeout(() => stop(`rendering took longer than ${options.timeoutMs} ms`), options.timeoutMs);
    const onAbort = () => stop('the call was cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > MAX_PNG_BYTES) {
        stop(`the image is over ${MAX_PNG_BYTES} bytes; split the diagram`);
      } else {
        out.push(chunk);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(0, 20000);
    });
    child.stdin.on('error', () => {
      // An early exit closes stdin; the exit code reports it.
    });
    let host = false;
    child.on('error', (error) => {
      const code = 'code' in error ? error.code : undefined;
      host = failure === undefined;
      failure ??=
        code === 'ENOENT'
          ? 'mermaid-cli (mmdc) is not on the gateway PATH. Install it on the gateway host, for example `brew install mermaid-cli`'
          : `mermaid-cli could not start (${String(code ?? error.message)}). Check that the mmdc on the gateway PATH is an executable install of mermaid-cli`;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      const png = Buffer.concat(out);
      const hostMessage = code !== 0 && failure === undefined ? hostFailure(stderr) : undefined;
      if (failure !== undefined) {
        resolve(host ? { ok: false, message: failure, host: true } : { ok: false, message: failure });
      } else if (hostMessage !== undefined) {
        resolve({ ok: false, message: hostMessage, host: true });
      } else if (code !== 0) {
        resolve({ ok: false, message: parseError(stderr) });
      } else if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
        resolve({ ok: false, message: 'mermaid-cli did not return a PNG' });
      } else {
        resolve({ ok: true, png });
      }
    });
    child.stdin.end(source);
  });
}
