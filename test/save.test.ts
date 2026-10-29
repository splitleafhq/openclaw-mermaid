import { strict as assert } from 'node:assert';
import { readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { saveDiagram, slugify, stamp } from '../src/save.ts';
import { temp } from './fixtures.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const at = () => new Date(Date.UTC(2026, 9, 24, 8, 5, 3));

test('a name collision picks a new suffix instead of overwriting', async () => {
  const dir = await temp();
  await writeFile(join(dir, '2026-10-24-080503-aaaaaa-mithral-hall.mmd'), 'kept');
  const seq = ['aaaaaa', 'bbbbbb'];
  const r = await saveDiagram(dir, 'Mithral Hall', 'graph TD', PNG, { now: at, hex: () => seq.shift() ?? 'cccccc' });
  assert.ok(r.ok);
  assert.equal(r.mmdPath, join(dir, '2026-10-24-080503-bbbbbb-mithral-hall.mmd'));
  assert.equal(await readFile(join(dir, '2026-10-24-080503-aaaaaa-mithral-hall.mmd'), 'utf8'), 'kept');
});

test('a collision on every attempt returns an error result', async () => {
  const dir = await temp();
  await writeFile(join(dir, '2026-10-24-080503-aaaaaa-x.mmd'), 'kept');
  const r = await saveDiagram(dir, 'x', 'graph TD', PNG, { now: at, hex: () => 'aaaaaa' });
  assert.deepEqual(r, { ok: false, message: 'could not pick an unused file name' });
});

test('a symlink at the chosen .png name is never followed or replaced', async () => {
  const dir = await temp();
  const outside = await temp();
  await writeFile(join(outside, 'target'), 'untouched');
  await symlink(join(outside, 'target'), join(dir, '2026-10-24-080503-aaaaaa-x.png'));
  const r = await saveDiagram(dir, 'x', 'graph TD', PNG, { now: at, hex: () => 'aaaaaa' });
  assert.equal(r.ok, false);
  assert.equal(await readFile(join(outside, 'target'), 'utf8'), 'untouched');
});

test('a path-like name stays inside the folder', async () => {
  const dir = await temp();
  const r = await saveDiagram(join(dir, 'd'), '../../etc/x', 'graph TD', PNG);
  assert.ok(r.ok);
  assert.deepEqual(await readdir(dir), ['d']);
  assert.match(r.base, /-etc-x$/);
});

test('slugify keeps [a-z0-9-], caps at 40 characters and falls back to "diagram"', () => {
  assert.equal(slugify('Drizzt Do’Urden: The Hunter\'s Blades!'), 'drizzt-do-urden-the-hunter-s-blades');
  assert.equal(slugify('a'.repeat(60)), 'a'.repeat(40));
  assert.equal(slugify(`${'a'.repeat(39)} b`), 'a'.repeat(39));
  assert.equal(slugify(''), 'diagram');
  assert.equal(slugify('研究'), 'diagram');
});

test('stamp is UTC', () => {
  assert.equal(stamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '2026-01-02-030405');
});
