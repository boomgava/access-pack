'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fullLogin } = require('../src/core/login');

const domain = { domainPrefix: 'company\\' };

test('добавляет префикс домена', () => {
  assert.equal(fullLogin('ivanov.i', domain), 'company\\ivanov.i');
  assert.equal(fullLogin('  ivanov.i ', domain), 'company\\ivanov.i');
});

test('префикс без обратной косой черты дополняется', () => {
  assert.equal(fullLogin('ivanov.i', { domainPrefix: 'company' }), 'company\\ivanov.i');
});

test('полный логин не трогает', () => {
  assert.equal(fullLogin('Компания\\ivanov.i', domain), 'Компания\\ivanov.i');
  assert.equal(fullLogin('ivanov@example.com', domain), 'ivanov@example.com');
});

test('без префикса — логин как есть', () => {
  assert.equal(fullLogin('ivanov.i', { domainPrefix: '' }), 'ivanov.i');
  assert.equal(fullLogin('ivanov.i', {}), 'ivanov.i');
  assert.equal(fullLogin('ivanov.i', undefined), 'ivanov.i');
});
