'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { historyEntries } = require('../src/core/history-entry');

const systems = [
  { id: 'domain', name: 'Домен Компания (Windows / RDP)', domainPrefix: 'company\\' },
  { id: 'mail', name: 'Корпоративная почта (Exchange)', domainPrefix: 'company\\' },
];
const employees = [
  { fio: 'Иванов Иван', accounts: [{ systemId: 'domain', login: 'ivanov.i', password: 'секрет' }, { systemId: 'mail', login: 'ivanov.i', password: 'секрет' }] },
  { fio: 'Петрова Анна', accounts: [{ systemId: 'domain', login: 'petrova.a', password: 'секрет' }] },
];
const results = [
  { fio: 'Иванов Иван', archive: 'Иванов Иван.zip', password: 'Ab1-Cd2', error: null },
  { fio: 'Петрова Анна', archive: 'Петрова Анна.zip', password: null, error: 'диск полон' },
];

test('записывается только то, что собралось', () => {
  const entries = historyEntries({ results, employees, systems, folder: '/out/пачка', encryption: 'zipcrypto' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].fio, 'Иванов Иван');
  assert.equal(entries[0].password, 'Ab1-Cd2');
  assert.equal(entries[0].folder, '/out/пачка');
  assert.equal(entries[0].encryption, 'zipcrypto');
});

test('логины сохраняются с доменом, пароли учёток — нет', () => {
  const [entry] = historyEntries({ results, employees, systems });
  assert.deepEqual(entry.accounts, [
    { system: 'Домен Компания (Windows / RDP)', login: 'company\\ivanov.i' },
    { system: 'Корпоративная почта (Exchange)', login: 'company\\ivanov.i' },
  ]);
  assert.ok(!JSON.stringify(entry).includes('секрет'));
});

test('вложения запоминаются именами файлов', () => {
  const [entry] = historyEntries({ results, employees, systems, attachments: ['/lib/RDP/Терминал.rdp', '/lib/Инструкции/VPN.pdf'] });
  assert.deepEqual(entry.attachments, ['Терминал.rdp', 'VPN.pdf']);
});

test('неизвестная система — пишем её идентификатор, а не падаем', () => {
  const [entry] = historyEntries({
    results: [results[0]],
    employees: [{ fio: 'Иванов Иван', accounts: [{ systemId: 'исчезла', login: 'ivanov.i' }] }],
    systems,
  });
  assert.deepEqual(entry.accounts, [{ system: 'исчезла', login: 'ivanov.i' }]);
});
