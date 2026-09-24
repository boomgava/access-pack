'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, isNewer, parseRelease, pickFile } = require('../src/core/version');

test('сравнение версий по числам, а не по строкам', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1, '10 больше 9');
  assert.equal(compareVersions('1.4.0', '1.4.0'), 0);
  assert.equal(compareVersions('1.4.0', '1.4.1'), -1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('v1.5.0', '1.5.0'), 0, 'префикс v не мешает');
});

test('предрелиз младше обычного релиза', () => {
  assert.equal(compareVersions('1.5.0-beta.1', '1.5.0'), -1);
  assert.equal(compareVersions('1.5.0', '1.5.0-beta.1'), 1);
  assert.ok(isNewer('1.5.0-beta.2', '1.4.0'));
});

test('обновление предлагается только если версия действительно новее', () => {
  assert.ok(isNewer('1.5.0', '1.4.0'));
  assert.ok(!isNewer('1.4.0', '1.4.0'));
  assert.ok(!isNewer('1.3.9', '1.4.0'));
});

const release = {
  tag_name: 'v1.5.0',
  html_url: 'https://github.com/owner/repo/releases/tag/v1.5.0',
  body: '  Что нового: отправка писем  ',
  assets: [
    { name: 'AccessPack-1.5.0-arm64.dmg', browser_download_url: 'https://example.com/arm64.dmg', size: 128 },
    { name: 'AccessPack-1.5.0-x64.dmg', browser_download_url: 'https://example.com/x64.dmg', size: 135 },
    { name: 'AccessPack-1.5.0-setup.exe', browser_download_url: 'https://example.com/setup.exe', size: 101 },
    { name: 'latest.yml', browser_download_url: 'https://example.com/latest.yml' },
  ],
};

test('разбор релиза: версия, ссылка, описание и файлы', () => {
  const info = parseRelease(release, '1.4.0');
  assert.equal(info.latest, '1.5.0');
  assert.equal(info.current, '1.4.0');
  assert.equal(info.newer, true);
  assert.equal(info.url, 'https://github.com/owner/repo/releases/tag/v1.5.0');
  assert.equal(info.notes, 'Что нового: отправка писем');
  assert.equal(info.files.length, 4);
});

test('черновик релиза игнорируется, мусор не ломает разбор', () => {
  assert.equal(parseRelease({ ...release, draft: true }, '1.4.0'), null);
  assert.equal(parseRelease({}, '1.4.0'), null);
  assert.equal(parseRelease(null, '1.4.0'), null);
});

test('файл подбирается под систему', () => {
  const { files } = parseRelease(release, '1.4.0');
  assert.equal(pickFile(files, { platform: 'darwin', arch: 'arm64' }).name, 'AccessPack-1.5.0-arm64.dmg');
  assert.equal(pickFile(files, { platform: 'darwin', arch: 'x64' }).name, 'AccessPack-1.5.0-x64.dmg');
  assert.equal(pickFile(files, { platform: 'win32', arch: 'x64' }).name, 'AccessPack-1.5.0-setup.exe');
  assert.equal(pickFile([], { platform: 'darwin' }), null);
});
