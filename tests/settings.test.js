'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { defaultSettings, loadSettings, saveSettings, importLogo, logoDataUrl, SETTINGS_VERSION } = require('../src/main/settings');
const { tmpDir } = require('./helpers');

test('нет файла — умолчания', async () => {
  const { settings, warning } = await loadSettings(tmpDir(), { outputPath: '/out' });
  assert.equal(warning, null);
  assert.equal(settings.outputPath, '/out');
  assert.equal(settings.encryption, 'zipcrypto');
  assert.equal(settings.defaultProfileId, 'main');
  assert.deepEqual(settings.systems.map((s) => s.id), ['domain', 'mail', 'yandex360', 'intraservice', 'm365']);
  assert.equal(settings.systems[0].domainPrefix, 'company\\');
  assert.equal(settings.systems[0].rdp, true);
  assert.deepEqual(settings.profiles.map((p) => p.name), ['Основной']);
});

test('умолчания не разделяют объекты между вызовами', () => {
  const a = defaultSettings();
  a.systems[0].name = 'изменено';
  assert.notEqual(defaultSettings().systems[0].name, 'изменено');
});

test('сохранение и загрузка', async () => {
  const dir = tmpDir();
  const s = defaultSettings({ outputPath: '/out' });
  s.libraryPath = '/lib';
  s.systems[2].url = 'https://intra.example';
  await saveSettings(dir, s);
  const { settings } = await loadSettings(dir, { outputPath: '/other' });
  assert.deepEqual(settings, s);
});

test('частичный файл дополняется умолчаниями', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ libraryPath: '/lib' }));
  const { settings } = await loadSettings(dir, { outputPath: '/out' });
  assert.equal(settings.libraryPath, '/lib');
  assert.equal(settings.outputPath, '/out');
  assert.equal(settings.systems.length, 5);
});

test('битый файл переименовывается, грузятся умолчания', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), '{oops');
  const { settings, warning } = await loadSettings(dir);
  assert.match(warning, /повреждён/);
  assert.equal(settings.systems.length, 5);
  const files = fs.readdirSync(dir);
  assert.ok(files.some((f) => /^settings\.broken-\d+\.json$/.test(f)));
  assert.ok(!files.includes('settings.json'));
});

test('логотип копируется и отдаётся как data URL', async () => {
  const dir = tmpDir();
  const src = path.join(tmpDir(), 'logo.PNG');
  fs.writeFileSync(src, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const name = await importLogo(dir, src);
  assert.match(name, /^logo-\d+\.png$/);
  assert.equal(await logoDataUrl(dir, name), 'data:image/png;base64,iVBORw==');
  assert.equal(await logoDataUrl(dir, ''), null);
  assert.equal(await logoDataUrl(dir, 'нет.png'), null);
});

test('логотип не того формата — ошибка', async () => {
  const src = path.join(tmpDir(), 'a.gif');
  fs.writeFileSync(src, 'x');
  await assert.rejects(importLogo(tmpDir(), src), /PNG, JPG или SVG/);
});

test('старый файл настроек: новые системы доезжают, устаревший шаг убирается', async () => {
  const dir = tmpDir();
  const old = {
    version: 1,
    libraryPath: '/lib',
    systems: [
      { id: 'domain', name: 'Домен', steps: ['Откройте файл подключения .rdp из архива', 'При первом входе система попросит сменить пароль'] },
      { id: 'yandex360', name: 'Мой Яндекс', url: 'https://ya.example' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(old));
  const { settings } = await loadSettings(dir);
  assert.equal(settings.version, SETTINGS_VERSION);
  assert.deepEqual(settings.systems.map((s) => s.id), ['domain', 'yandex360', 'mail', 'intraservice', 'm365']);
  assert.deepEqual(settings.systems[0].steps, ['Откройте файл подключения .rdp из архива']);
  assert.equal(settings.systems[1].name, 'Мой Яндекс', 'правки пользователя не затираются');
});
