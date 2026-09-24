'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mascots, mascotDataUrl, MASCOTS } = require('../src/main/themes');

const DIR = path.join(__dirname, '..', 'src', 'assets', 'themes');

test('у каждой встроенной картинки есть файл, название и авторство', () => {
  assert.ok(MASCOTS.length >= 3);
  const ids = new Set();
  for (const m of MASCOTS) {
    assert.ok(!ids.has(m.id), `повтор id: ${m.id}`);
    ids.add(m.id);
    assert.ok(fs.existsSync(path.join(DIR, m.file)), `нет файла ${m.file}`);
    assert.ok(m.name && m.credit, `нет названия или автора у ${m.id}`);
    assert.match(m.credit, /CC/, `в подписи ${m.id} нет лицензии`);
  }
});

test('лицензии описаны в ATTRIBUTION.md', () => {
  const text = fs.readFileSync(path.join(DIR, 'ATTRIBUTION.md'), 'utf8');
  for (const m of MASCOTS) assert.ok(text.includes(m.file), `${m.file} не описан в ATTRIBUTION.md`);
});

test('список для интерфейса без путей к файлам', () => {
  for (const m of mascots()) {
    assert.deepEqual(Object.keys(m).sort(), ['credit', 'id', 'name']);
  }
});

test('картинка отдаётся только из списка', async () => {
  const url = await mascotDataUrl(MASCOTS[0].id);
  assert.match(url, /^data:image\/png;base64,/);
  assert.equal(await mascotDataUrl('../../../etc/passwd'), null);
  assert.equal(await mascotDataUrl(''), null);
  assert.equal(await mascotDataUrl('нет такой'), null);
});
