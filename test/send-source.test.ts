import { strict as assert } from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { type Delivery, defined, fakeEnvironment, install, recordingDelivery, sourceReply, temp, text } from './fixtures.ts';

const FLOW = 'flowchart LR\n  regis["Regis"] --> bruenor["Bruenor"]';

before(async () => {
  await fakeEnvironment();
});

function tools(ws: string, delivery?: Delivery, pluginConfig: Record<string, unknown> = {}) {
  const host = install({ pluginConfig });
  return { render: defined(host.toolFor(ws, delivery)), sendSource: defined(host.toolFor(ws, delivery, 'send_mermaid_source')) };
}

const mmdPath = (r: { content: { text?: string }[] }) => defined(/(\S+\.mmd)/.exec(text(r))?.[1]);

test('asking for the source later sends only its .txt, never the image again', async () => {
  const ws = await temp();
  const delivery = recordingDelivery();
  const { render, sendSource } = tools(ws, delivery);
  const drawn = await render.execute('c1', { source: FLOW, caption: 'The companions' });
  assert.equal(delivery.sent.length, 1);
  const r = await sendSource.execute('c2', { file: mmdPath(drawn), caption: 'Here it is.' });
  assert.equal(delivery.sent.length, 2, 'one more send: the .txt alone');
  const txt = defined(delivery.sent[1]?.mediaUrl);
  assert.match(txt, /\.txt$/);
  assert.equal(await readFile(txt, 'utf8'), FLOW);
  assert.deepEqual(sourceReply(r), { text: 'Here it is.' });
});

test('the source can be named by the full path or the bare file name', async () => {
  const ws = await temp();
  const delivery = recordingDelivery();
  const { render, sendSource } = tools(ws, delivery);
  const path = mmdPath(await render.execute('c1', { source: FLOW, caption: 'x' }));
  const bare = path.split('/').at(-1);
  await sendSource.execute('c2', { file: defined(bare) });
  assert.equal(await readFile(defined(delivery.sent[1]?.mediaUrl), 'utf8'), FLOW);
});

test('a file render_mermaid did not create is refused, and nothing is sent', async () => {
  const ws = await temp();
  const delivery = recordingDelivery();
  const { sendSource } = tools(ws, delivery);
  await writeFile(join(ws, 'notes.mmd'), 'private');
  for (const file of ['../../etc/passwd', 'notes.mmd', '../notes.mmd', 'out/diagrams/x.txt']) {
    const r = await sendSource.execute('c1', { file });
    assert.match(text(r), /^send_mermaid_source failed: file must be the \.mmd path/, file);
  }
  const missing = await sendSource.execute('c2', { file: '2026-10-24-080503-aaaaaa-drizzt.mmd' });
  assert.match(text(missing), /^send_mermaid_source failed: 2026-10-24-080503-aaaaaa-drizzt\.mmd is not in the diagrams folder/);
  assert.equal(delivery.sent.length, 0);
});

test('without a delivery helper the .txt goes in the reply', async () => {
  const ws = await temp();
  const { render, sendSource } = tools(ws);
  const path = mmdPath(await render.execute('c1', { source: FLOW, caption: 'x' }));
  const reply = defined(sourceReply(await sendSource.execute('c2', { file: path })));
  assert.equal(defined(reply.mediaUrls).length, 1);
  assert.equal(await readFile(defined(reply.mediaUrls?.[0]), 'utf8'), FLOW);
});

test('a send that fails returns an error result, not a throw', async () => {
  const ws = await temp();
  const { render } = tools(ws);
  const path = mmdPath(await render.execute('c1', { source: FLOW, caption: 'x' }));
  const broken: Delivery = {
    send: async () => {
      throw new Error('room gone');
    },
  };
  const r = await tools(ws, broken).sendSource.execute('c2', { file: path });
  assert.match(text(r), /^send_mermaid_source failed: the source could not be sent/);
});
