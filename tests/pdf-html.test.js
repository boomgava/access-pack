'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPdfHtml } = require('../src/core/pdf-html');

const base = {
  fio: 'Иванов <b>Иван</b>',
  date: new Date(2026, 8, 22),
  profile: { company: 'Компания', support: 'Тел. 1234\nhelp@example.com' },
  accounts: [
    { system: { name: 'Домен Компания', url: '', steps: ['Откройте файл', ' '] }, login: 'company\\ivanov.i', password: 'P<1>' },
    { system: { name: 'Яндекс 360', url: 'https://mail.yandex.ru/', steps: [] }, login: 'i@x.ru', password: 'Ya' },
  ],
  logoDataUrl: null,
};

test('экранирует пользовательские данные', () => {
  const html = buildPdfHtml(base);
  assert.ok(html.includes('Иванов &lt;b&gt;Иван&lt;/b&gt;'));
  assert.ok(html.includes('P&lt;1&gt;'));
  assert.ok(!html.includes('<b>Иван'));
});

test('карточка на каждую учётку с логином и паролем', () => {
  const html = buildPdfHtml(base);
  assert.equal(html.match(/<section class="card">/g).length, 2);
  assert.ok(html.includes('company\\ivanov.i'));
  assert.ok(html.includes('>Яндекс 360<'));
});

test('адрес входа — ссылка, подпись без схемы', () => {
  const html = buildPdfHtml(base);
  assert.ok(html.includes('href="https://mail.yandex.ru/"'));
  assert.ok(html.includes('>mail.yandex.ru</a>'));
});

test('пустые шаги пропускаются, без шагов нет списка', () => {
  const html = buildPdfHtml(base);
  assert.equal(html.match(/<li>/g).length, 1);
  assert.equal(html.match(/<ol/g).length, 1);
});

test('логотип вместо названия компании', () => {
  assert.ok(buildPdfHtml(base).includes('<div class="company">Компания</div>'));
  const withLogo = buildPdfHtml({ ...base, logoDataUrl: 'data:image/png;base64,AAA' });
  assert.ok(withLogo.includes('<img class="logo" src="data:image/png;base64,AAA"'));
  assert.ok(!withLogo.includes('class="company"'));
});

test('дата, заголовок и контакты поддержки', () => {
  const html = buildPdfHtml(base);
  assert.ok(html.includes('22.09.2026'));
  assert.ok(html.includes('Доступы к рабочим системам'));
  assert.ok(html.includes('Тел. 1234<br>help@example.com'));
  assert.ok(!buildPdfHtml({ ...base, profile: { company: 'X', support: '  ' } }).includes('class="support"'));
});
