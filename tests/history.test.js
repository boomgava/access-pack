'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadHistory, appendHistory, deleteHistoryEntry, clearHistory } = require('../src/main/history');
const { tmpDir } = require('./helpers');

const NOW = new Date('2026-09-23T10:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const entry = (fio, extra = {}) => ({ fio, archive: `${fio}.zip`, password: 'Ab1-Cd2-Ef3', ...extra });

test('нет файла — история пустая', async () => {
  const { entries, warning } = await loadHistory(tmpDir());
  assert.deepEqual(entries, []);
  assert.equal(warning, null);
});

test('запись получает id и дату, новые идут первыми', async () => {
  const dir = tmpDir();
  await appendHistory(dir, [entry('Иванов')], { now: new Date(NOW.getTime() - 1000) });
  const { entries } = await appendHistory(dir, [entry('Петрова')], { now: NOW });
  assert.deepEqual(entries.map((e) => e.fio), ['Петрова', 'Иванов']);
  assert.match(entries[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(entries[0].at, NOW.toISOString());
  assert.equal(entries[0].password, 'Ab1-Cd2-Ef3');
});

test('записи старше срока хранения удаляются', async () => {
  const dir = tmpDir();
  await appendHistory(dir, [entry('Старый', { at: daysAgo(100) }), entry('Свежий', { at: daysAgo(10) })], { keepDays: 90, now: NOW });
  const { entries } = await loadHistory(dir, { keepDays: 90, now: NOW });
  assert.deepEqual(entries.map((e) => e.fio), ['Свежий']);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'));
  assert.equal(onDisk.entries.length, 1, 'просроченное стирается и с диска');
});

test('состав архива сохраняется как есть', async () => {
  const dir = tmpDir();
  const accounts = [{ system: 'Домен Компания (Windows / RDP)', login: 'company\\ivanov.i' }];
  await appendHistory(dir, [entry('Иванов', { accounts, attachments: ['Терминал.rdp'], folder: '/out/2026-09-23' })], { now: NOW });
  const { entries } = await loadHistory(dir, { now: NOW });
  assert.deepEqual(entries[0].accounts, accounts);
  assert.deepEqual(entries[0].attachments, ['Терминал.rdp']);
  assert.equal(entries[0].folder, '/out/2026-09-23');
});

test('удаление одной записи и очистка всей истории', async () => {
  const dir = tmpDir();
  const { entries } = await appendHistory(dir, [entry('Иванов'), entry('Петрова')], { now: NOW });
  const after = await deleteHistoryEntry(dir, entries[0].id);
  assert.equal(after.entries.length, 1);
  assert.equal((await clearHistory(dir)).entries.length, 0);
  assert.deepEqual((await loadHistory(dir)).entries, []);
});

test('битый файл переименовывается, история начинается заново', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'history.json'), '{oops');
  const { entries, warning } = await loadHistory(dir);
  assert.deepEqual(entries, []);
  assert.match(warning, /повреждён/);
  assert.ok(fs.readdirSync(dir).some((f) => /^history\.broken-\d+\.json$/.test(f)));
});
