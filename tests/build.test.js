'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildBatch, preflight } = require('../src/main/build');
const { defaultSettings } = require('../src/main/settings');
const { readZipPy, tmpDir, utf16rdp, which } = require('./helpers');

const NOW = new Date(2026, 8, 22, 15, 30);
const settings = defaultSettings();
const RDP_SRC = 'full address:s:rds.example.com\r\nprompt for credentials:i:1\r\n';

function setup() {
  const root = tmpDir();
  const lib = path.join(root, 'lib');
  const out = path.join(root, 'out');
  fs.mkdirSync(path.join(lib, 'ПО'), { recursive: true });
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(lib, 'Терминал.rdp'), utf16rdp(RDP_SRC));
  fs.writeFileSync(path.join(lib, 'Инструкция.txt'), 'Инструкция');
  fs.writeFileSync(path.join(lib, 'ПО', 'setup.bin'), Buffer.from([1, 2, 3]));
  return { lib, out, attachments: ['Терминал.rdp', 'Инструкция.txt', 'ПО'].map((n) => path.join(lib, n)) };
}

const fakePdf = async (d) =>
  Buffer.from(`PDF ${d.fio}: ${d.accounts.map((a) => `${a.system.id}=${a.login}/${a.password}`).join(', ')}`);

const EMPLOYEES = [
  {
    fio: 'Иванов Иван Иванович',
    accounts: [
      { systemId: 'domain', login: 'ivanov.i', password: 'P@ss-1' },
      { systemId: 'yandex360', login: 'i.ivanov@example.com', password: 'Ya-2' },
    ],
  },
  { fio: 'Петрова Анна', accounts: [{ systemId: 'yandex360', login: 'a.petrova@example.com', password: 'Ya-3' }] },
];

function run(env, input = {}, deps = {}) {
  return buildBatch(
    {
      employees: EMPLOYEES,
      attachments: env.attachments,
      systems: settings.systems,
      profile: settings.profiles[0],
      encryption: 'zipcrypto',
      outDir: env.out,
      now: NOW,
      ...input,
    },
    { renderPdf: fakePdf, ...deps },
  );
}

const zipNames = (entries) => entries.map((e) => e.name).sort();

test('архив на каждого сотрудника, прогресс и Пароли.txt', async () => {
  const env = setup();
  const progress = [];
  const res = await run(env, {}, { onProgress: (p) => progress.push(p) });
  assert.equal(path.basename(res.folder), 'Доступы_2026-09-22_15-30');
  assert.deepEqual(
    res.results.map((r) => [r.fio, r.archive, r.error]),
    [
      ['Иванов Иван Иванович', 'Иванов_Иван.zip', null],
      ['Петрова Анна', 'Петрова_Анна.zip', null],
    ],
  );
  for (const r of res.results) assert.match(r.password, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  assert.notEqual(res.results[0].password, res.results[1].password);
  assert.deepEqual(progress, [
    { done: 1, total: 2 },
    { done: 2, total: 2 },
  ]);
  assert.equal(res.passwordsFile, path.join(res.folder, 'Пароли.txt'));
  const txt = fs.readFileSync(res.passwordsFile, 'utf8');
  assert.ok(txt.includes(res.results[0].password) && txt.includes(res.results[1].password));
});

test('в архиве PDF с полным логином, вложения и .rdp с логином', async () => {
  const env = setup();
  const res = await run(env);
  const entries = readZipPy(path.join(res.folder, 'Иванов_Иван.zip'), res.results[0].password);
  assert.deepEqual(zipNames(entries), ['ПО/', 'ПО/setup.bin', 'Доступы — Иванов И.И.pdf', 'Инструкция.txt', 'Терминал.rdp'].sort());
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
  assert.match(byName['Доступы — Иванов И.И.pdf'].data.toString(), /domain=company\\ivanov\.i\/P@ss-1/);
  const rdp = byName['Терминал.rdp'].data;
  assert.deepEqual([...rdp.subarray(0, 2)], [0xff, 0xfe]);
  assert.match(rdp.subarray(2).toString('utf16le'), /username:s:company\\ivanov\.i\r\n/);
  assert.deepEqual([...byName['ПО/setup.bin'].data], [1, 2, 3]);
});

test('без доменной учётки .rdp кладётся без изменений', async () => {
  const env = setup();
  const res = await run(env);
  const entries = readZipPy(path.join(res.folder, 'Петрова_Анна.zip'), res.results[1].password);
  const rdp = entries.find((e) => e.name === 'Терминал.rdp').data;
  assert.deepEqual(rdp, utf16rdp(RDP_SRC));
});

test('без вложений в архиве только PDF', async () => {
  const env = setup();
  const res = await run(env, { attachments: [] });
  const entries = readZipPy(path.join(res.folder, 'Петрова_Анна.zip'), res.results[1].password);
  assert.deepEqual(zipNames(entries), ['Доступы — Петрова А.pdf']);
});

test('одинаковые ФИО получают _2', async () => {
  const env = setup();
  const res = await run(env, { employees: [EMPLOYEES[1], EMPLOYEES[1]] });
  assert.deepEqual(res.results.map((r) => r.archive), ['Петрова_Анна.zip', 'Петрова_Анна_2.zip']);
});

test('сбой PDF у одного не мешает остальным', async () => {
  const env = setup();
  const renderPdf = async (d) => {
    if (d.fio === 'Петрова Анна') throw new Error('сбой рендера');
    return fakePdf(d);
  };
  const res = await run(env, {}, { renderPdf });
  assert.equal(res.results[0].error, null);
  assert.equal(res.results[1].error, 'сбой рендера');
  assert.equal(res.results[1].password, null);
  assert.equal(fs.existsSync(path.join(res.folder, 'Петрова_Анна.zip')), false);
  assert.ok(fs.readFileSync(res.passwordsFile, 'utf8').includes('НЕ СОБРАН: сбой рендера'));
});

test('повторная сборка в ту же минуту — папка _2', async () => {
  const env = setup();
  const first = await run(env);
  const second = await run(env);
  assert.equal(path.basename(first.folder), 'Доступы_2026-09-22_15-30');
  assert.equal(path.basename(second.folder), 'Доступы_2026-09-22_15-30_2');
});

test('AES-256: 7-Zip проверяет архив', { skip: !which('7zz') && '7zz не установлен' }, async () => {
  const env = setup();
  const res = await run(env, { encryption: 'aes256' });
  const r = spawnSync('7zz', ['t', `-p${res.results[0].password}`, path.join(res.folder, 'Иванов_Иван.zip')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('preflight: нет вложения и нет папки вывода', async () => {
  const env = setup();
  const errs = await preflight({ attachments: [path.join(env.lib, 'нет.pdf')], outDir: path.join(env.out, 'нет') });
  assert.deepEqual(errs.map((e) => e.field), ['attachment', 'outDir']);
  assert.equal(errs[0].path, path.join(env.lib, 'нет.pdf'));
  assert.match(errs[0].message, /нет\.pdf/);
});

test('preflight: всё на месте — без ошибок и без мусора в папке', async () => {
  const env = setup();
  assert.deepEqual(await preflight({ attachments: env.attachments, outDir: env.out }), []);
  assert.deepEqual(fs.readdirSync(env.out), []);
});

test('preflight: пустая папка вывода — ошибка', async () => {
  const errs = await preflight({ attachments: [], outDir: '' });
  assert.deepEqual(errs.map((e) => e.field), ['outDir']);
});
