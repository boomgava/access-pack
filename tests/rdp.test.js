'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setRdpUsername } = require('../src/core/rdp');
const { utf16rdp } = require('./helpers');

const LOGIN = 'company\\ivanov.i';

test('UTF-16 LE с BOM и CRLF: строка username заменяется', () => {
  const src = utf16rdp('full address:s:rds.example.com\r\nusername:s:old\r\nscreen mode id:i:2\r\n');
  const out = setRdpUsername(src, LOGIN);
  assert.deepEqual([...out.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal(
    out.subarray(2).toString('utf16le'),
    'full address:s:rds.example.com\r\nusername:s:company\\ivanov.i\r\nscreen mode id:i:2\r\n',
  );
});

test('UTF-8 без BOM и LF: строка добавляется перед хвостовой пустой строкой', () => {
  const out = setRdpUsername(Buffer.from('full address:s:srv\nscreen mode id:i:2\n'), LOGIN);
  assert.equal(out.toString('utf8'), 'full address:s:srv\nscreen mode id:i:2\nusername:s:company\\ivanov.i\n');
});

test('UTF-8 с BOM: BOM сохраняется', () => {
  const src = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('full address:s:srv\r\n')]);
  const out = setRdpUsername(src, LOGIN);
  assert.deepEqual([...out.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(out.subarray(3).toString('utf8'), 'full address:s:srv\r\nusername:s:company\\ivanov.i\r\n');
});

test('регистр ключа не важен, строка username остаётся одна', () => {
  const out = setRdpUsername(Buffer.from('UserName:s:x\r\nfull address:s:srv\r\n'), LOGIN).toString('utf8');
  assert.equal(out, 'username:s:company\\ivanov.i\r\nfull address:s:srv\r\n');
});

test('пустой файл: одна строка с CRLF', () => {
  assert.equal(setRdpUsername(Buffer.alloc(0), LOGIN).toString('utf8'), 'username:s:company\\ivanov.i\r\n');
});
