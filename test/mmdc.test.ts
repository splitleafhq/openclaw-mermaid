/** Runs the real mermaid-cli when it is on PATH (a gateway host); skipped where it isn't, such as CI. */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { renderPng } from '../src/render.ts';

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
