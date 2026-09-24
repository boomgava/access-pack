'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPasswordsTxt } = require('../src/core/passwords-txt');

test('UTF-8 с BOM, CRLF, успешные и несобранные', () => {
  const buf = formatPasswordsTxt({
    date: new Date(2026, 8, 22, 15, 30),
    encryption: 'zipcrypto',
    results: [
      { fio: 'Иванов Иван', archive: 'Иванов_Иван.zip', password: 'Kq7m-Xp4r-Tz9w', error: null },
      { fio: 'Петрова Анна', archive: 'Петрова_Анна.zip', password: null, error: 'сбой' },
    ],
  });
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = buf.subarray(3).toString('utf8');
  assert.ok(text.startsWith('Доступы от 22.09.2026 15:30 · архивов: 1 · шифрование: ZipCrypto\r\n\r\n'));
  assert.ok(text.includes('Иванов Иван\r\n  Архив:  Иванов_Иван.zip\r\n  Пароль: Kq7m-Xp4r-Tz9w\r\n'));
  assert.ok(text.includes('Петрова Анна\r\n  НЕ СОБРАН: сбой\r\n'));
  assert.doesNotMatch(text, /[^\r]\n/);
});

test('подпись AES-256', () => {
  const text = formatPasswordsTxt({ date: new Date(2026, 0, 1), encryption: 'aes256', results: [] }).toString('utf8');
  assert.match(text, /шифрование: AES-256/);
});
