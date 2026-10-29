/** A stand-in for OpenClaw's plugin API and for mermaid-cli. All names and text are synthetic. */
import { strict as assert } from 'node:assert';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { type PluginHost, registerMermaid } from '../src/index.ts';

export interface ToolResult {
  content: { text?: string }[];
  details?: unknown;
}

interface ToolLike {
  name: string;
  canDeliverSourceReply?: boolean;
  execute(id: string, params: unknown, signal?: AbortSignal): Promise<ToolResult>;
}

function isTool(value: unknown): value is ToolLike {
  return typeof value === 'object' && value !== null && 'execute' in value && typeof value.execute === 'function';
}

export function defined<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null, 'expected a value');
  return value;
}

const roots: string[] = [];
after(() => Promise.all(roots.map((r) => rm(r, { recursive: true, force: true }))));

export async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openclaw-mermaid-'));
  roots.push(dir);
  return dir;
}

/**
 * A fake `mmdc` that answers by keyword in the source: SYNTAX fails like a parse error, HANG never exits (and starts
 * a child that would outlive it), NOTPNG prints text, HUGE prints more than the media limit. Anything else is a PNG.
 */
const FAKE_MMDC = `#!/usr/bin/env node
const { spawn } = require('node:child_process');
let src = '';
process.stdin.on('data', (c) => (src += c));
process.stdin.on('end', () => {
  if (src.includes('SYNTAX')) {
    process.stderr.write("Error: Parse error on line 2:\\n...A --> B[[[\\n---^\\nExpecting 'TAGEND', got 'SQS'\\nParser.parseError (https://mermaid-cli-intercept.invalid/x.mjs:1:1)\\n    at async renderMermaid (file:///x/index.js:1:1)\\n");
    process.exit(1);
  }
  if (src.includes('HANG')) {
    const child = spawn(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)', process.env.FAKE_MMDC_PIDFILE], { stdio: 'ignore' });
    child.unref();
    setInterval(() => {}, 1000);
    return;
  }
  if (src.includes('NOTPNG')) {
    process.stdout.write('not an image');
    return;
  }
  if (src.includes('HUGE')) {
    process.stdout.write(Buffer.alloc(6 * 1024 * 1024));
    return;
  }
  process.stdout.write(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(src)]));
});
`;

/** Puts the fake `mmdc` first on PATH and points OpenClaw's media store at a temporary state folder. */
export async function fakeEnvironment(): Promise<{ bin: string; state: string }> {
  const bin = await temp();
  const state = await temp();
  await writeFile(join(bin, 'mmdc'), FAKE_MMDC);
  await chmod(join(bin, 'mmdc'), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH ?? ''}`;
  process.env.OPENCLAW_STATE_DIR = state;
  return { bin, state };
}

export interface Delivery {
  send(params: { text?: string; mediaUrl?: string }): Promise<void>;
}

/** A stand-in for the host's delivery helper that records each send, in order. */
export function recordingDelivery(): Delivery & { sent: { text?: string; mediaUrl?: string }[] } {
  const sent: { text?: string; mediaUrl?: string }[] = [];
  return {
    sent,
    send: async (params) => {
      sent.push(params);
    },
  };
}

export interface Options {
  pluginConfig?: Record<string, unknown>;
}

export function install({ pluginConfig = {} }: Options = {}) {
  const factories: ((ctx: { workspaceDir?: string; delivery?: Delivery }) => unknown)[] = [];
  const warnings: string[] = [];
  const api: PluginHost = {
    pluginConfig,
    logger: { warn: (message) => warnings.push(message) },
    registerTool: (tool: unknown) => {
      if (typeof tool === 'function') {
        factories.push((ctx) => tool(ctx));
      }
    },
  };
  registerMermaid(api);
  return {
    warnings,
    toolFor(workspaceDir: string | undefined, delivery?: Delivery, name = 'render_mermaid'): ToolLike | undefined {
      const tools = factories.map((factory) => factory({ workspaceDir, delivery }));
      return tools.find((tool): tool is ToolLike => isTool(tool) && tool.name === name);
    },
  };
}

export const text = (r: ToolResult) => r.content.map((c) => c.text ?? '').join('');

export interface SourceReply {
  text?: string;
  mediaUrls?: string[];
}

export function sourceReply(r: ToolResult): SourceReply | undefined {
  const d = r.details;
  if (typeof d !== 'object' || d === null || !('sourceReply' in d)) {
    return undefined;
  }
  const s = d.sourceReply;
  assert.ok(typeof s === 'object' && s !== null);
  const replyText = 'text' in s && typeof s.text === 'string' ? s.text : undefined;
  if (!('mediaUrls' in s)) {
    return { text: defined(replyText) };
  }
  assert.ok(Array.isArray(s.mediaUrls));
  return { ...(replyText === undefined ? {} : { text: replyText }), mediaUrls: s.mediaUrls.map(String) };
}
