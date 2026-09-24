'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { ZipWriter } = require('../src/core/zip/writer');
const { readZipPy, tmpDir, which, pythonCmd } = require('./helpers');

const PASSWORD = 'Kq7m-Xp4r-Tz9w';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const has7z = which('7zz');
const skip7z = !has7z && '7zz не установлен (brew install sevenzip)';
const skipPy = !pythonCmd() && 'python3 не установлен';
const skipUnzip = !which('unzip') && 'unzip не установлен';

async function makeArchive(method, dir) {
  const big = crypto.randomBytes(3 * 1024 * 1024 + 123); // несколько чанков потока и блоков ключевого потока
  const bigPath = path.join(dir, 'big.bin');
  fs.writeFileSync(bigPath, big);
  const pdf = Buffer.from('%PDF-1.7 тестовый документ');
  const file = path.join(dir, `test-${method}.zip`);
  const w = await ZipWriter.create(file, { password: PASSWORD, method });
  await w.addBuffer('Доступы — Иванов И.И.pdf', pdf);
  await w.addDirectory('ПО/');
  await w.addFile('ПО/установщик.bin', bigPath);
  await w.addBuffer('пусто.txt', Buffer.alloc(0));
  await w.close();
  return {
    file,
    expected: { 'Доступы — Иванов И.И.pdf': pdf, 'ПО/установщик.bin': big, 'пусто.txt': Buffer.alloc(0) },
  };
}

test('ZipCrypto: Python читает имена, флаги и содержимое', { skip: skipPy }, async () => {
  const { file, expected } = await makeArchive('zipcrypto', tmpDir());
  const entries = readZipPy(file, PASSWORD);
  assert.deepEqual(
    entries.map((e) => e.name),
    ['Доступы — Иванов И.И.pdf', 'ПО/', 'ПО/установщик.bin', 'пусто.txt'],
  );
  for (const e of entries) {
    if (e.name.endsWith('/')) {
      assert.equal(e.flags, 0x0800);
      continue;
    }
    assert.equal(e.flags, 0x0801);
    assert.equal(e.method, 8);
    assert.equal(sha(e.data), sha(expected[e.name]), e.name);
  }
});

test('ZipCrypto: неверный пароль не подходит', { skip: skipPy }, async () => {
  const { file } = await makeArchive('zipcrypto', tmpDir());
  assert.throws(() => readZipPy(file, 'wrong-pass'));
});

test('ZipCrypto: unzip -t проходит проверку CRC', { skip: skipUnzip }, async () => {
  const { file } = await makeArchive('zipcrypto', tmpDir());
  const r = spawnSync('unzip', ['-t', '-P', PASSWORD, file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /No errors detected/);
});

test('AES-256: метод 99 и флаги в заголовках', { skip: skipPy }, async () => {
  const { file } = await makeArchive('aes256', tmpDir());
  const f = readZipPy(file, PASSWORD, { data: false }).find((e) => e.name === 'пусто.txt');
  assert.equal(f.method, 99);
  assert.equal(f.flags, 0x0801);
});

test('AES-256: 7-Zip распаковывает, кириллица и содержимое целы', { skip: skip7z }, async () => {
  const dir = tmpDir();
  const { file, expected } = await makeArchive('aes256', dir);
  const out = path.join(dir, 'out');
  const r = spawnSync('7zz', ['x', `-p${PASSWORD}`, `-o${out}`, '-y', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const [name, data] of Object.entries(expected)) {
    assert.equal(sha(fs.readFileSync(path.join(out, name))), sha(data), name);
  }
});

test('AES-256: с неверным паролем 7-Zip падает', { skip: skip7z }, async () => {
  const { file } = await makeArchive('aes256', tmpDir());
  const r = spawnSync('7zz', ['t', '-pwrong', file], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
});

test('ZipCrypto: 7-Zip тоже распаковывает', { skip: skip7z }, async () => {
  const dir = tmpDir();
  const { file, expected } = await makeArchive('zipcrypto', dir);
  const out = path.join(dir, 'out');
  const r = spawnSync('7zz', ['x', `-p${PASSWORD}`, `-o${out}`, '-y', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sha(fs.readFileSync(path.join(out, 'ПО/установщик.bin'))), sha(expected['ПО/установщик.bin']));
});

test('два файла с одним именем — ошибка', async () => {
  const w = await ZipWriter.create(path.join(tmpDir(), 'd.zip'), { password: PASSWORD, method: 'zipcrypto' });
  await w.addBuffer('a.txt', Buffer.from('1'));
  await assert.rejects(w.addBuffer('A.TXT', Buffer.from('2')), /одним именем/);
  await w.abort();
});

test('abort удаляет недописанный архив', async () => {
  const file = path.join(tmpDir(), 'x.zip');
  const w = await ZipWriter.create(file, { password: PASSWORD, method: 'zipcrypto' });
  await w.addBuffer('a.txt', Buffer.from('1'));
  await w.abort();
  assert.equal(fs.existsSync(file), false);
});

test('без пароля или с неизвестным шифрованием — ошибка', async () => {
  const dir = tmpDir();
  await assert.rejects(ZipWriter.create(path.join(dir, 'a.zip'), { password: '', method: 'zipcrypto' }), /пароль/);
  await assert.rejects(ZipWriter.create(path.join(dir, 'b.zip'), { password: 'x', method: 'rar' }), /шифрование/);
});

test('существующий файл не перезаписывается', async () => {
  const file = path.join(tmpDir(), 'exists.zip');
  fs.writeFileSync(file, 'x');
  await assert.rejects(ZipWriter.create(file, { password: PASSWORD, method: 'zipcrypto' }), /EEXIST/);
});
