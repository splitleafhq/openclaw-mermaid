/** Runs the real mermaid-cli when it is on PATH (a gateway host); skipped where it isn't, such as CI. */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderPng } from '../src/render.ts';
import { temp } from './fixtures.ts';

function hasMmdc(): boolean {
  try {
    execFileSync('mmdc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const skip = hasMmdc() ? false : 'mmdc is not on PATH';

test('real mmdc renders a flowchart to PNG', { skip }, async () => {
  const r = await renderPng('flowchart LR\n  bruenor["Bruenor"] --> mithral["Mithral Hall"]', { timeoutMs: 30000 });
  assert.ok(r.ok);
  assert.ok(r.png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
});

test('real mmdc reports a parse error with the line', { skip }, async () => {
  const r = await renderPng('flowchart LR\n  a --> b[[[ oops', { timeoutMs: 30000 });
  assert.equal(r.ok, false);
  assert.match(r.message, /Parse error on line 2/);
});

test('real mmdc fetches nothing a diagram names, at any host', { skip }, async () => {
  let hits = 0;
  const server = createServer((_req, res) => {
    hits += 1;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(typeof address === 'object' && address !== null);
  const source = `flowchart LR\n  a["<img src='http://127.0.0.1:${address.port}/x.png'> Entreri"] --> b["Jarlaxle"]`;
  try {
    const r = await renderPng(source, { timeoutMs: 30000 });
    assert.ok(r.ok);
    assert.equal(hits, 0);
  } finally {
    server.close();
  }
});

test('real mmdc embeds no local file a label names, by img, svg image or CSS url', { skip }, async () => {
  const dir = await temp();
  const secret = await renderPng('flowchart LR\n  catti["Catti-brie"] --> taulmaril["Taulmaril"]', { timeoutMs: 30000 });
  assert.ok(secret.ok);
  await writeFile(join(dir, 'secret.png'), secret.png);
  const path = join(dir, 'secret.png');
  const missing = join(dir, 'missing.png');
  const labels = [
    (p: string) => `<img src=${p}>`,
    (p: string) => `<svg><image href=${p}></image></svg>`,
    (p: string) => `<span style='background:url(${p})'>x</span>`,
  ];
  for (const label of labels) {
    const render = async (p: string) => {
      const r = await renderPng(`flowchart LR\n  a["${label(p)}"] --> b["Wulfgar"]`, { timeoutMs: 30000 });
      assert.ok(r.ok);
      return r.png;
    };
    assert.ok((await render(path)).equals(await render(missing)), label('<path>'));
  }
});
