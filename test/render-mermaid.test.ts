import { strict as assert } from 'node:assert';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { unfence } from '../src/index.ts';
import { defined, fakeEnvironment, install, sourceReply, temp, text } from './fixtures.ts';

const FLOW = 'flowchart LR\n  drizzt["Drizzt"] --> guenhwyvar["Guenhwyvar"]';

let env: { bin: string; state: string };
before(async () => {
  env = await fakeEnvironment();
});

async function tool(workspace?: string, pluginConfig: Record<string, unknown> = {}) {
  return defined(install({ pluginConfig }).toolFor(workspace ?? (await temp())));
}

test('a diagram is sent as a PNG with the caption, and the .mmd and .png are kept in the workspace', async () => {
  const ws = await temp();
  const t = await tool(ws);
  assert.equal(t.canDeliverSourceReply, true);
  const r = await t.execute('c1', { source: FLOW, name: 'Icewind Dale', caption: 'Here is the party.' });
  const reply = defined(sourceReply(r));
  assert.equal(reply.text, 'Here is the party.');
  assert.equal(reply.mediaUrls.length, 1);
  const sent = await readFile(defined(reply.mediaUrls[0]));
  assert.ok(sent.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
  assert.ok(defined(reply.mediaUrls[0]).startsWith(join(env.state, 'media', 'outbound')), 'staged in the media store');
  const names = (await readdir(join(ws, 'out', 'diagrams'))).toSorted();
  assert.equal(names.length, 2);
  assert.match(defined(names[0]), /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}-icewind-dale\.mmd$/);
  assert.equal(await readFile(join(ws, 'out', 'diagrams', defined(names[0])), 'utf8'), FLOW);
  assert.ok((await readFile(join(ws, 'out', 'diagrams', defined(names[1])))).equals(sent));
  assert.match(text(r), new RegExp(`out/diagrams/${defined(names[0]).replace('.', '\\.')}`));
  assert.doesNotMatch(text(r), new RegExp(ws), 'paths in the workspace are shown relative to it');
});

test('the source is sent only when asked: inline as a mermaid block, or as a .txt file', async () => {
  const t = await tool();
  const none = defined(sourceReply(await t.execute('c1', { source: FLOW })));
  assert.equal(none.mediaUrls.length, 1);
  assert.doesNotMatch(none.text, /```/);

  const inline = defined(sourceReply(await t.execute('c2', { source: FLOW, caption: 'Regis', includeSource: 'inline' })));
  assert.equal(inline.text, `Regis\n\n\`\`\`mermaid\n${FLOW}\n\`\`\``);
  assert.equal(inline.mediaUrls.length, 1);

  const file = defined(sourceReply(await t.execute('c3', { source: FLOW, includeSource: 'file' })));
  assert.equal(file.mediaUrls.length, 2);
  assert.match(defined(file.mediaUrls[1]), /\.txt$/);
  assert.equal(await readFile(defined(file.mediaUrls[1]), 'utf8'), FLOW);
});

test('a source wrapped in a mermaid fence is rendered without the fence', async () => {
  const ws = await temp();
  const t = await tool(ws);
  await t.execute('c1', { source: `\`\`\`mermaid\n${FLOW}\n\`\`\`\n` });
  const mmd = (await readdir(join(ws, 'out', 'diagrams'))).find((n) => n.endsWith('.mmd'));
  assert.equal(await readFile(join(ws, 'out', 'diagrams', defined(mmd)), 'utf8'), FLOW);
  assert.equal(unfence('```\nA\n```'), 'A');
  assert.equal(unfence('graph TD; A-->B'), 'graph TD; A-->B');
});

test('a syntax error returns the parser message without the stack, and nothing is sent or saved', async () => {
  const ws = await temp();
  const t = await tool(ws);
  const r = await t.execute('c1', { source: 'flowchart LR\n  SYNTAX' });
  assert.equal(sourceReply(r), undefined);
  assert.match(text(r), /^render_mermaid failed: Parse error on line 2:/);
  assert.match(text(r), /Expecting 'TAGEND', got 'SQS'/);
  assert.doesNotMatch(text(r), /intercept|at async/);
  assert.deepEqual(r.details, { status: 'failed' });
  await assert.rejects(readdir(join(ws, 'out', 'diagrams')));
});

test('a render past timeoutMs is stopped, child processes included, and reported', async () => {
  const pidFile = join(await temp(), 'pid');
  process.env.FAKE_MMDC_PIDFILE = pidFile;
  const t = await tool(undefined, { timeoutMs: 1000 });
  const started = Date.now();
  const r = await t.execute('c1', { source: 'HANG' });
  assert.ok(Date.now() - started < 5000);
  assert.match(text(r), /longer than 1000 ms/);
  const pid = Number(await readFile(pidFile, 'utf8'));
  await sleep(200);
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'the child Chrome stand-in is gone');
});

test('a cancelled call stops the render', async () => {
  process.env.FAKE_MMDC_PIDFILE = join(await temp(), 'pid');
  const t = await tool();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const r = await t.execute('c1', { source: 'HANG' }, controller.signal);
  assert.match(text(r), /cancelled/);
  const started = Date.now();
  assert.match(text(await t.execute('c2', { source: 'HANG' }, AbortSignal.abort())), /cancelled/);
  assert.ok(Date.now() - started < 1000, 'an already-cancelled call does not start a render');
});

test('output that is not a PNG, or over the media limit, is refused', async () => {
  const t = await tool();
  assert.match(text(await t.execute('c1', { source: 'NOTPNG' })), /did not return a PNG/);
  assert.match(text(await t.execute('c2', { source: 'HUGE' })), /over 5242880 bytes/);
});

test('a missing mmdc says how to install it', async () => {
  const saved = process.env.PATH;
  process.env.PATH = await temp();
  try {
    const r = await (await tool()).execute('c1', { source: FLOW });
    assert.match(text(r), /mmdc\) is not on the gateway PATH.*brew install mermaid-cli/);
  } finally {
    process.env.PATH = saved;
  }
});

test('empty source, and source over maxSourceChars, are refused before rendering', async () => {
  const t = await tool(undefined, { maxSourceChars: 50 });
  assert.match(text(await t.execute('c1', { source: '  \n' })), /source is empty/);
  assert.match(text(await t.execute('c2', { source: `graph TD\n${'a'.repeat(60)}` })), /limit is 50/);
});

test('saveDir: absolute is used as given and shown in full; relative is under the workspace', async () => {
  const ws = await temp();
  const outside = await temp();
  const abs = await tool(ws, { saveDir: outside });
  const r = await abs.execute('c1', { source: FLOW, name: 'wulfgar' });
  assert.equal((await readdir(outside)).length, 2);
  assert.match(text(r), new RegExp(`Saved ${outside}/`));

  const rel = await tool(ws, { saveDir: 'charts' });
  await rel.execute('c2', { source: FLOW });
  assert.equal((await readdir(join(ws, 'charts'))).length, 2);
});

test('a saveDir that cannot be written returns an error result and sends nothing', async () => {
  const ws = await temp();
  await writeFile(join(ws, 'blocked'), 'a file, not a folder');
  const r = await (await tool(ws, { saveDir: 'blocked' })).execute('c1', { source: FLOW });
  assert.match(text(r), /^render_mermaid failed: saving failed/);
  assert.equal(sourceReply(r), undefined);
});

test('without a workspace or an absolute saveDir the tool is not offered', () => {
  const host = install();
  assert.equal(host.toolFor(undefined), undefined);
  assert.match(host.warnings.join('\n'), /not offered/);
  assert.ok(install({ pluginConfig: { saveDir: '/srv/diagrams' } }).toolFor(undefined));
});
