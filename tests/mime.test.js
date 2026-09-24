'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMessage, encodeWord, formatAddress, isEmail, parseAddresses } = require('../src/core/mime');

const decodeWords = (s) =>
  s.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b64) => Buffer.from(b64, 'base64').toString('utf8')).replace(/\r\n /g, '');

test('русская тема кодируется и разбирается обратно', () => {
  const encoded = encodeWord('Доступы к рабочим системам');
  assert.match(encoded, /^=\?UTF-8\?B\?/);
  assert.equal(decodeWords(encoded), 'Доступы к рабочим системам');
});

test('латиница остаётся как есть', () => {
  assert.equal(encodeWord('Access pack'), 'Access pack');
});

test('адрес с русским именем', () => {
  const addr = formatAddress({ name: 'Корчак Александр', email: 'korchak@example.net' });
  assert.equal(decodeWords(addr), 'Корчак Александр <korchak@example.net>');
  assert.equal(formatAddress({ name: 'Ivan Ivanov', email: 'i@x.ru' }), '"Ivan Ivanov" <i@x.ru>');
  assert.equal(formatAddress('i@x.ru'), 'i@x.ru');
});

test('письмо без вложений: заголовки и текст в base64', () => {
  const msg = buildMessage({
    from: { name: 'ИТ-отдел', email: 'it@example.com' },
    to: 'user@example.com',
    subject: 'Тема',
    text: 'Первая строка\nВторая строка',
    date: new Date('2026-09-24T12:00:00Z'),
    messageId: '<1@access-pack>',
  });
  assert.match(msg, /^From: =\?UTF-8\?B\?/);
  assert.ok(msg.includes('To: user@example.com\r\n'));
  assert.ok(msg.includes('Content-Type: text/plain; charset=utf-8'));
  assert.ok(!msg.includes('Cc:'), 'пустая копия не выводится');
  const body = msg.split('\r\n\r\n')[1];
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'Первая строка\r\nВторая строка');
});

test('копия выводится и принимает список', () => {
  const msg = buildMessage({ from: 'a@b.ru', to: 'c@d.ru', cc: ['e@f.ru', { name: 'Напарник', email: 'g@h.ru' }], subject: 'x' });
  const line = msg.split('\r\n').find((l) => l.startsWith('Cc: '));
  assert.equal(decodeWords(line), 'Cc: e@f.ru, Напарник <g@h.ru>');
});

test('вложение с русским именем: multipart, base64 и RFC 2231', () => {
  const content = Buffer.from('PK архив');
  const msg = buildMessage({
    from: 'a@b.ru',
    to: 'c@d.ru',
    subject: 'Доступы',
    text: 'Письмо',
    attachments: [{ filename: 'Корчак_Александр.zip', content, contentType: 'application/zip' }],
  });
  const boundary = msg.match(/boundary="([^"]+)"/)[1];
  assert.ok(msg.includes(`--${boundary}--`), 'закрывающая граница');
  assert.ok(msg.includes("filename*=UTF-8''%D0%9A%D0%BE%D1%80%D1%87%D0%B0%D0%BA"), 'имя файла по RFC 2231');
  assert.ok(msg.includes('Content-Disposition: attachment;'));
  const part = msg.split(`--${boundary}`)[2];
  const b64 = part.split('\r\n\r\n')[1].trim().split('\r\n').join('');
  assert.deepEqual(Buffer.from(b64, 'base64'), content, 'вложение доезжает байт в байт');
});

test('строки укладываются в лимиты: base64 — 76, любая строка — 998', () => {
  const msg = buildMessage({
    from: 'a@b.ru',
    to: 'c@d.ru',
    text: 'Текст '.repeat(200),
    attachments: [{ filename: 'Архив с очень длинным русским именем файла.zip', content: Buffer.alloc(5000, 7) }],
  });
  for (const line of msg.split('\r\n')) {
    assert.ok(line.length <= 998, `строка длиннее 998: ${line.length}`);
    if (/^[A-Za-z0-9+/=]+$/.test(line)) assert.ok(line.length <= 76, `base64 длиннее 76: ${line.length}`);
  }
});

test('проверка адреса ловит опечатки', () => {
  for (const ok of ['a@b.ru', 'm.melnikov@example.net', 'a-b_c@sub.domain.co']) assert.ok(isEmail(ok), ok);
  for (const bad of ['', 'без-собаки.ru', 'a@b', 'a b@c.ru', 'a@b.ru, c@d.ru']) assert.ok(!isEmail(bad), bad);
});

test('список адресов разбирается по запятой и точке с запятой', () => {
  assert.deepEqual(parseAddresses('a@b.ru, c@d.ru; e@f.ru'), ['a@b.ru', 'c@d.ru', 'e@f.ru']);
  assert.deepEqual(parseAddresses(''), []);
});
