import { strict as assert } from 'node:assert';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { unfence } from '../src/index.ts';
import { renderPng } from '../src/render.ts';
import { type Delivery, defined, fakeEnvironment, install, recordingDelivery, sourceReply, status, temp, text } from './fixtures.ts';

const FLOW = 'flowchart LR\n  drizzt["Drizzt"] --> guenhwyvar["Guenhwyvar"]';

let env: { bin: string; state: string };
before(async () => {
  env = await fakeEnvironment();
});

async function tool(workspace?: string, pluginConfig: Record<string, unknown> = {}, delivery?: Delivery) {
  return defined(install({ pluginConfig }).toolFor(workspace ?? (await temp()), delivery));
}

const isPng = (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

test('the PNG and the caption go out together as the reply, so the channel sends one captioned image', async () => {
  const ws = await temp();
  const delivery = recordingDelivery();
  const t = await tool(ws, {}, delivery);
  assert.equal(t.canDeliverSourceReply, true);
  const r = await t.execute('c1', { source: FLOW, name: 'Icewind Dale', caption: 'Here is the party.' });
  assert.deepEqual(delivery.sent, [], 'nothing goes out ahead of the reply');
  const reply = defined(sourceReply(r));
  assert.equal(reply.text, 'Here is the party.');
  assert.equal(defined(reply.mediaUrls).length, 1);
  const mediaUrl = defined(reply.mediaUrls?.[0]);
  assert.ok(mediaUrl.startsWith(join(env.state, 'media', 'outbound')), 'staged in the media store');
  const sent = await readFile(mediaUrl);
  assert.ok(isPng(sent));
  const names = (await readdir(join(ws, 'out', 'diagrams'))).toSorted();
  assert.equal(names.length, 2);
  const [mmd, png] = [defined(names[0]), defined(names[1])];
  // README: `<stamp>-<hex>-<name>.mmd` and `.png` under out/diagrams.
  assert.match(mmd, /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}-icewind-dale\.mmd$/);
  assert.equal(png, `${mmd.slice(0, -4)}.png`, 'the source and the image share one name');
  assert.equal(await readFile(join(ws, 'out', 'diagrams', mmd), 'utf8'), FLOW);
  assert.ok((await readFile(join(ws, 'out', 'diagrams', png))).equals(sent));
  assert.deepEqual(await readdir(ws), ['out'], 'nothing is written in the workspace outside out/diagrams');
  assert.deepEqual(await readdir(join(ws, 'out')), ['diagrams']);
  assert.match(text(r), new RegExp(`Saved out/diagrams/${mmd.replace('.', '\\.')} and out/diagrams/${png.replace('.', '\\.')}\\.`));
  assert.doesNotMatch(text(r), new RegExp(ws), 'paths in the workspace are shown relative to it');
});

test('the source goes only as a .txt file, after the image, and only when asked; never inline', async () => {
  const delivery = recordingDelivery();
  const t = await tool(undefined, {}, delivery);
  const plain = defined(sourceReply(await t.execute('c1', { source: FLOW, caption: 'Regis' })));
  assert.equal(defined(plain.mediaUrls).length, 1);
  assert.doesNotMatch(defined(plain.text), /```|flowchart/);

  const asked = defined(sourceReply(await t.execute('c2', { source: FLOW, caption: 'Regis', attachSource: true })));
  assert.equal(asked.text, 'Regis');
  assert.equal(defined(asked.mediaUrls).length, 2);
  assert.ok(isPng(await readFile(defined(asked.mediaUrls?.[0]))));
  const txt = defined(asked.mediaUrls?.[1]);
  assert.match(txt, /\.txt$/);
  assert.equal(await readFile(txt, 'utf8'), FLOW);
  assert.deepEqual(delivery.sent, []);
});

test('source "always" sends the .txt after the image without being asked', async () => {
  const delivery = recordingDelivery();
  const r = await (await tool(undefined, { source: 'always' }, delivery)).execute('c1', { source: FLOW, caption: 'Cattie-brie' });
  const media = defined(defined(sourceReply(r)).mediaUrls);
  assert.equal(media.length, 2);
  assert.ok(isPng(await readFile(defined(media[0]))));
  assert.equal(await readFile(defined(media[1]), 'utf8'), FLOW);
});

test('textPosition "before" sends the text first, then the image and .txt as the reply', async () => {
  const delivery = recordingDelivery();
  const t = await tool(undefined, { textPosition: 'before' }, delivery);
  const r = await t.execute('c1', { source: FLOW, caption: 'Wulfgar', attachSource: true });
  assert.deepEqual(delivery.sent, [{ text: 'Wulfgar' }]);
  const reply = defined(sourceReply(r));
  assert.equal(defined(reply.mediaUrls).length, 2);
  assert.ok(isPng(await readFile(defined(reply.mediaUrls?.[0]))));
  assert.match(defined(reply.mediaUrls?.[1]), /\.txt$/);
});

test('with no caption the image is still the reply, with no empty text', async () => {
  const delivery = recordingDelivery();
  const r = await (await tool(undefined, {}, delivery)).execute('c1', { source: FLOW });
  const reply = defined(sourceReply(r));
  assert.equal(reply.text, undefined);
  assert.equal(defined(reply.mediaUrls).length, 1);
  assert.equal(status(r), 'sent');
  // The model reads the text, not the status field.
  assert.match(text(r), /^Sent the diagram/);
});

test('without a delivery helper the image and caption go together in the reply', async () => {
  const t = await tool();
  const reply = defined(sourceReply(await t.execute('c1', { source: FLOW, caption: 'Bruenor', attachSource: true })));
  assert.equal(reply.text, 'Bruenor');
  assert.equal(defined(reply.mediaUrls).length, 2);
  assert.ok(isPng(await readFile(defined(reply.mediaUrls?.[0]))));
});

test('a text-first send that fails returns an error result, not a throw', async () => {
  const delivery: Delivery = {
    send: async () => {
      throw new Error('room gone');
    },
  };
  const r = await (await tool(undefined, { textPosition: 'before' }, delivery)).execute('c1', { source: FLOW, caption: 'x' });
  assert.equal(status(r), 'failed');
  assert.match(text(r), /could not be sent/);
  assert.equal(sourceReply(r), undefined);
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

test('a missing browser is a logged host error with the install command, not a syntax error to retry', async () => {
  const host = install();
  const t = defined(host.toolFor(await temp()));
  const r = await t.execute('c1', { source: 'flowchart LR\n  NOBROWSER' });
  assert.equal(status(r), 'failed');
  // The tool description and the skill tell the model not to retry on this prefix.
  assert.match(text(r), /^render_mermaid failed: host error, not the source: /);
  assert.match(text(r), /browsers install chrome-headless-shell@156\.0\.8078\.47/);
  assert.equal(host.warnings.length, 1, 'the operator sees it in the gateway log');
});

test('a render past timeoutMs is stopped, child processes included, and reported', async () => {
  const pidFile = join(await temp(), 'pid');
  process.env.FAKE_MMDC_PIDFILE = pidFile;
  const t = await tool(undefined, { timeoutMs: 1000 });
  const started = Date.now();
  const r = await t.execute('c1', { source: 'HANG' });
  assert.ok(Date.now() - started < 5000);
  assert.equal(status(r), 'failed');
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
  const notPng = await t.execute('c1', { source: 'NOTPNG' });
  assert.equal(status(notPng), 'failed');
  assert.match(text(notPng), /did not return a PNG/);
  const huge = await t.execute('c2', { source: 'HUGE' });
  assert.equal(status(huge), 'failed');
  assert.match(text(huge), /over 5242880 bytes/);
});

test('a missing mmdc says how to install it', async () => {
  const saved = process.env.PATH;
  process.env.PATH = await temp();
  try {
    const host = install();
    const r = await defined(host.toolFor(await temp())).execute('c1', { source: FLOW });
    assert.equal(status(r), 'failed');
    // README documents the install hint and the host-error prefix; the model relays one and stops on the other.
    assert.match(text(r), /^render_mermaid failed: host error, not the source: mermaid-cli \(mmdc\) is not on the gateway PATH.*brew install mermaid-cli/);
    assert.equal(host.warnings.length, 1);
  } finally {
    process.env.PATH = saved;
  }
});

test('empty source, and source over maxSourceChars, are refused before rendering', async () => {
  const t = await tool(undefined, { maxSourceChars: 50 });
  const empty = await t.execute('c1', { source: '  \n' });
  assert.equal(status(empty), 'failed');
  assert.match(text(empty), /empty/);
  const long = await t.execute('c2', { source: `graph TD\n${'a'.repeat(60)}` });
  assert.equal(status(long), 'failed');
  assert.match(text(long), /limit is 50/);
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
  assert.equal(status(r), 'failed');
  assert.match(text(r), /saving failed/);
  assert.equal(sourceReply(r), undefined);
});

test('without a workspace or an absolute saveDir the tool is not offered', () => {
  const host = install();
  assert.equal(host.toolFor(undefined), undefined);
  assert.equal(host.warnings.length, 1, 'the operator is warned once');
  assert.ok(install({ pluginConfig: { saveDir: '/srv/diagrams' } }).toolFor(undefined));
});

async function standIn(body: string, mode = 0o755): Promise<string> {
  const file = join(await temp(), 'mmdc');
  await writeFile(file, `#!/usr/bin/env node\n${body}\n`, { mode });
  return file;
}

test('a long error from mermaid-cli reaches the model capped at 1000 characters', async () => {
  const command = await standIn("process.stderr.write('Error: ' + 'x'.repeat(30000) + '\\n'); process.exit(1);");
  const r = await renderPng('flowchart LR\n  a --> b', { timeoutMs: 10000, command });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.message.length, 1000);
});

test('mermaid-cli failing with no message still gives the model a reason', async () => {
  const command = await standIn('process.exit(1);');
  const r = await renderPng('flowchart LR\n  a --> b', { timeoutMs: 10000, command });
  assert.deepEqual(r, { ok: false, message: 'mermaid-cli failed without an error message' });
});

test('an mmdc that exists but cannot be started is reported as that, not as missing', async () => {
  const command = await standIn('process.exit(0);', 0o644);
  const r = await renderPng('flowchart LR\n  a --> b', { timeoutMs: 10000, command });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.message : '', /could not start/);
  assert.equal(r.ok === false && r.host, true, 'a host error, so the model does not retry the source');
  assert.doesNotMatch(r.ok === false ? r.message : '', /not on the gateway PATH/);
});
