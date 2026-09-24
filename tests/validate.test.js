'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBatch } = require('../src/core/validate');

const systems = [{ id: 'domain' }, { id: 'yandex360' }];
const acc = (over = {}) => ({ id: 'a1', systemId: 'domain', login: 'ivanov.i', password: 'x', ...over });
const emp = (over = {}) => ({ id: 'e1', fio: 'Иванов Иван', accounts: [acc()], ...over });
const fields = (errs) => errs.map((e) => e.field);

test('корректная пачка — без ошибок', () => {
  assert.deepEqual(validateBatch([emp()], systems), []);
});

test('пустая пачка', () => {
  assert.deepEqual(fields(validateBatch([], systems)), ['batch']);
});

test('нет ФИО и нет учёток', () => {
  const errs = validateBatch([emp({ fio: '   ', accounts: [] })], systems);
  assert.deepEqual(fields(errs), ['fio', 'accounts']);
  assert.equal(errs[0].employeeId, 'e1');
});

test('ошибки учётки привязаны к employeeId и accountId', () => {
  const errs = validateBatch([emp({ accounts: [acc({ systemId: 'gone', login: '  ', password: '' })] })], systems);
  assert.deepEqual(fields(errs), ['system', 'login', 'password']);
  for (const e of errs) {
    assert.equal(e.employeeId, 'e1');
    assert.equal(e.accountId, 'a1');
    assert.ok(e.message);
  }
});

test('пароль из пробелов считается заполненным', () => {
  assert.deepEqual(validateBatch([emp({ accounts: [acc({ password: '  ' })] })], systems), []);
});

test('с галочкой отправки адрес обязателен и проверяется', () => {
  const systems = [{ id: 'domain' }];
  const emp = (email) => ({ id: 'e1', fio: 'Иванов Иван', email, accounts: [{ id: 'a1', systemId: 'domain', login: 'i', password: 'p' }] });
  assert.deepEqual(validateBatch([emp('i@x.ru')], systems, { requireEmail: true }), []);
  assert.deepEqual(validateBatch([emp('')], systems, { requireEmail: true }).map((e) => e.message), ['Укажите почту для отправки']);
  assert.deepEqual(validateBatch([emp('опечатка@x')], systems, { requireEmail: true }).map((e) => e.message), ['Проверьте адрес почты']);
  assert.deepEqual(validateBatch([emp('')], systems), [], 'без галочки почта не нужна');
});
