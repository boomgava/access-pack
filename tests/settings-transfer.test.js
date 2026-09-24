'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExport, parseImport, mergeImported } = require('../src/core/settings-transfer');

const settings = {
  version: 3,
  libraryPath: '/Users/ivanov/Documents/Шаблоны',
  outputPath: '/Users/ivanov/Desktop/Архивы',
  encryption: 'aes256',
  theme: 'kawaii',
  mascot: 'neko',
  historyDays: 90,
  mail: {
    host: 'mail.example.com',
    port: 587,
    security: 'starttls',
    user: 'ivanov@example.com',
    from: 'ivanov@example.com',
    fromName: 'ИТ-отдел',
    cc: 'petrov@example.com',
    subject: 'Доступы',
    template: 'Доброго дня, {Имя}!',
  },
  systems: [{ id: 'domain', name: 'Домен', domainPrefix: 'company\\' }],
  profiles: [{ id: 'main', name: 'Основной', company: 'Компания', logoFile: 'logo-1.png' }],
};

test('в файл переноса попадают настройки и логотипы, но не пароль', () => {
  const out = buildExport(settings, { files: { 'logo-1.png': 'data:image/png;base64,AAA' }, appVersion: '1.4.0' });
  assert.equal(out.marker, 'access-pack-settings');
  assert.equal(out.appVersion, '1.4.0');
  assert.deepEqual(out.settings.systems, settings.systems);
  assert.equal(out.files['logo-1.png'], 'data:image/png;base64,AAA');
  assert.ok(!JSON.stringify(out).includes('password'), 'пароль почты не экспортируется');
});

test('чужой файл отвергается с понятной ошибкой', () => {
  assert.match(parseImport('{}').error, /не файл настроек/);
  assert.match(parseImport('не json').error, /не получилось прочитать JSON/);
  assert.match(parseImport({ marker: 'access-pack-settings' }).error, /нет настроек/);
  assert.match(parseImport({ marker: 'access-pack-settings', settings: {} }).error, /ни систем, ни профилей/);
});

test('разбор файла показывает, что внутри', () => {
  const file = JSON.stringify(buildExport(settings, { files: { 'logo-1.png': 'data:image/png;base64,AAA' } }));
  const res = parseImport(file);
  assert.equal(res.ok, true);
  assert.deepEqual(res.summary, { systems: 1, profiles: 1, logos: 1, mail: true, paths: true });
});

const current = {
  version: 3,
  libraryPath: '/Users/petrov/Шаблоны',
  outputPath: '/Users/petrov/Архивы',
  theme: 'dark',
  mail: { host: '', user: 'petrov@example.com', from: 'petrov@example.com', cc: 'ivanov@example.com', template: 'своё' },
  systems: [],
  profiles: [],
};

test('режим «общее»: системы и шаблон приезжают, свои папки и адреса остаются', () => {
  const next = mergeImported(current, settings, { mode: 'shared' });
  assert.deepEqual(next.systems, settings.systems, 'справочник систем приехал');
  assert.deepEqual(next.profiles, settings.profiles);
  assert.equal(next.mail.host, 'mail.example.com', 'сервер приехал');
  assert.equal(next.mail.template, 'Доброго дня, {Имя}!', 'шаблон приехал');
  assert.equal(next.mail.user, 'petrov@example.com', 'логин остался свой');
  assert.equal(next.mail.cc, 'ivanov@example.com', 'копия осталась своя');
  assert.equal(next.libraryPath, '/Users/petrov/Шаблоны', 'папки остались свои');
  assert.equal(next.outputPath, '/Users/petrov/Архивы');
  assert.equal(next.theme, 'kawaii', 'оформление приезжает');
});

test('режим «всё»: принимаем файл целиком', () => {
  const next = mergeImported(current, settings, { mode: 'all' });
  assert.equal(next.libraryPath, settings.libraryPath);
  assert.equal(next.mail.user, 'ivanov@example.com');
  assert.equal(next.mail.cc, 'petrov@example.com');
});

test('версия настроек берётся своя — миграции решают остальное', () => {
  const next = mergeImported({ ...current, version: 3 }, { ...settings, version: 99 }, { mode: 'all' });
  assert.equal(next.version, 3);
});
