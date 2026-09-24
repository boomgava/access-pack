'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateArchivePassword, ALPHABET } = require('../src/core/password');

test('формат XXXX-XXXX-XXXX', () => {
  for (let i = 0; i < 200; i++) {
    assert.match(generateArchivePassword(), /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  }
});

test('нет похожих символов I O l o 0 1', () => {
  const all = Array.from({ length: 500 }, () => generateArchivePassword()).join('');
  assert.doesNotMatch(all, /[IOlo01]/);
});

test('алфавит — 56 уникальных символов', () => {
  assert.equal(ALPHABET.length, 56);
  assert.equal(new Set(ALPHABET).size, 56);
});

test('пароли не повторяются', () => {
  const set = new Set(Array.from({ length: 1000 }, () => generateArchivePassword()));
  assert.equal(set.size, 1000);
});
