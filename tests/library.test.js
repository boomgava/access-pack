'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listLibrary, collectEntries } = require('../src/main/library');
const { tmpDir } = require('./helpers');

// Библиотека «Шаблоны для отправки»: подпапки верхнего уровня — разделы
function makeLib() {
  const lib = tmpDir();
  for (const f of ['Памятка.pdf', '.DS_Store', 'Thumbs.db', 'desktop.ini', '~$doc.docx']) {
    fs.writeFileSync(path.join(lib, f), 'x');
  }
  fs.mkdirSync(path.join(lib, 'RDP'));
  fs.writeFileSync(path.join(lib, 'RDP', 'Терминал.rdp'), 'x');
  fs.writeFileSync(path.join(lib, 'RDP', '1С бухгалтерия.rdp'), 'x');
  fs.mkdirSync(path.join(lib, 'Инструкции'));
  fs.writeFileSync(path.join(lib, 'Инструкции', 'VPN.pdf'), 'x');
  fs.mkdirSync(path.join(lib, 'ПО', 'Клиент 1С'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'ПО', 'AnyDesk.exe'), 'x');
  fs.writeFileSync(path.join(lib, 'ПО', '.hidden'), 'x');
  fs.writeFileSync(path.join(lib, 'ПО', 'Клиент 1С', 'setup.msi'), 'x');
  fs.mkdirSync(path.join(lib, 'Пусто'));
  return lib;
}

test('listLibrary: разделы по папкам, внутри папки первыми', async () => {
  const lib = makeLib();
  const { groups, error } = await listLibrary(lib);
  assert.equal(error, null);
  assert.deepEqual(
    groups.map((g) => [g.name, g.items.map((i) => [i.name, i.kind])]),
    [
      ['Инструкции', [['VPN.pdf', 'file']]],
      ['ПО', [['Клиент 1С', 'dir'], ['AnyDesk.exe', 'file']]],
      ['RDP', [['1С бухгалтерия.rdp', 'file'], ['Терминал.rdp', 'file']]],
      ['Без раздела', [['Памятка.pdf', 'file']]],
    ],
  );
  assert.equal(groups[0].path, path.join(lib, 'Инструкции'));
  assert.equal(groups[0].items[0].path, path.join(lib, 'Инструкции', 'VPN.pdf'));
  assert.equal(groups[3].path, lib);
});

test('listLibrary: пустой раздел не показывается', async () => {
  const { groups } = await listLibrary(makeLib());
  assert.ok(!groups.some((g) => g.name === 'Пусто'));
});

test('listLibrary: библиотека без подпапок — один раздел «Без раздела»', async () => {
  const lib = tmpDir();
  fs.writeFileSync(path.join(lib, 'Терминал.rdp'), 'x');
  const { groups } = await listLibrary(lib);
  assert.deepEqual(groups.map((g) => [g.name, g.items.length]), [['Без раздела', 1]]);
});

test('listLibrary: пустая библиотека — разделов нет', async () => {
  assert.deepEqual(await listLibrary(tmpDir()), { groups: [], error: null });
});

test('listLibrary: папка не выбрана или не найдена', async () => {
  assert.deepEqual(await listLibrary(''), { groups: [], error: 'Папка библиотеки не выбрана' });
  assert.deepEqual(await listLibrary(path.join(tmpDir(), 'нет')), { groups: [], error: 'Папка не найдена' });
});

test('collectEntries разворачивает папки рекурсивно', async () => {
  const lib = makeLib();
  const entries = await collectEntries([
    path.join(lib, 'ПО'),
    path.join(lib, 'RDP', 'Терминал.rdp'),
    path.join(lib, 'Пусто'),
  ]);
  assert.deepEqual(entries.map((e) => [e.zipPath, e.kind]), [
    ['ПО/', 'dir'],
    ['ПО/Клиент 1С/', 'dir'],
    ['ПО/Клиент 1С/setup.msi', 'file'],
    ['ПО/AnyDesk.exe', 'file'],
    ['Терминал.rdp', 'file'],
    ['Пусто/', 'dir'],
  ]);
  assert.equal(entries[2].srcPath, path.join(lib, 'ПО', 'Клиент 1С', 'setup.msi'));
});

test('collectEntries: одинаковые имена из разных папок получают _2', async () => {
  const a = tmpDir();
  const b = tmpDir();
  fs.writeFileSync(path.join(a, 'Инструкция.pdf'), '1');
  fs.writeFileSync(path.join(b, 'Инструкция.pdf'), '2');
  const entries = await collectEntries([path.join(a, 'Инструкция.pdf'), path.join(b, 'Инструкция.pdf')]);
  assert.deepEqual(entries.map((e) => e.zipPath), ['Инструкция.pdf', 'Инструкция_2.pdf']);
});

test('collectEntries: отсутствующий путь — ошибка', async () => {
  await assert.rejects(collectEntries([path.join(tmpDir(), 'нет.pdf')]), /ENOENT/);
});
