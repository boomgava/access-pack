'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderTemplate, pickTemplate } = require('../src/core/mail-text');

test('подстановки имени, фамилии и архива', () => {
  const out = renderTemplate('Здравствуйте, {Имя}! Архив {Архив} для {ФИО}. Фамилия: {Фамилия}', {
    fio: 'Корчак Александр Николаевич',
    archive: 'Корчак_Александр.zip',
  });
  assert.equal(out, 'Здравствуйте, Александр! Архив Корчак_Александр.zip для Корчак Александр Николаевич. Фамилия: Корчак');
});

test('если в ФИО одно слово — «Имя» берётся из него', () => {
  assert.equal(renderTemplate('{Имя}/{Фамилия}', { fio: 'Иванов' }), 'Иванов/Иванов');
});

test('неизвестная подстановка остаётся в тексте, чтобы её заметили', () => {
  assert.equal(renderTemplate('{Пароль} и {Имя}', { fio: 'Иванов Иван' }), '{Пароль} и Иван');
});

test('пустой шаблон и пустые данные не ломают ничего', () => {
  assert.equal(renderTemplate('', {}), '');
  assert.equal(renderTemplate('Текст без подстановок'), 'Текст без подстановок');
  assert.equal(renderTemplate('{Имя}', {}), '');
});

test('архив без пароля — свой текст письма', () => {
  const mail = { template: 'Пароль сообщу отдельно', templateNoPassword: 'Архив открывается сразу' };
  assert.equal(pickTemplate(mail, { noPassword: true }), 'Архив открывается сразу');
  assert.equal(pickTemplate(mail, { noPassword: false }), 'Пароль сообщу отдельно');
  assert.equal(pickTemplate(mail), 'Пароль сообщу отдельно');
});

test('если текст для архивов без пароля стёрли — берём обычный', () => {
  assert.equal(pickTemplate({ template: 'обычный', templateNoPassword: '' }, { noPassword: true }), 'обычный');
  assert.equal(pickTemplate({}, { noPassword: true }), '');
  assert.equal(pickTemplate(null, { noPassword: true }), '');
});
