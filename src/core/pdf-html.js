'use strict';
const { formatDate } = require('./format');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function urlBlock(url) {
  if (!url) return '';
  const label = String(url).replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (!/^https?:\/\//i.test(url)) return `<div class="url">${esc(label)}</div>`;
  return `<a class="url" href="${esc(url)}">${esc(label)}</a>`;
}

function card({ system, login, password }) {
  const steps = (system.steps || []).map((s) => String(s).trim()).filter(Boolean);
  const stepsHtml = steps.length ? `<ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '';
  return `<section class="card">
  <div class="card-head"><div class="sys">${esc(system.name)}</div>${urlBlock(system.url)}</div>
  <div class="creds">
    <div class="label">Логин</div><div class="value">${esc(login)}</div>
    <div class="label">Пароль</div><div class="value"><span class="secret">${esc(password)}</span></div>
  </div>${stepsHtml}
</section>`;
}

// Тело документа с доступами; стили — src/pdf/pdf.css
function buildPdfHtml({ fio, date, profile, accounts, logoDataUrl }) {
  const brand = logoDataUrl
    ? `<img class="logo" src="${esc(logoDataUrl)}" alt="">`
    : `<div class="company">${esc(profile.company)}</div>`;
  // примечание задаётся в профиле: у каждой компании свой порядок смены пароля
  const note = String(profile.note || '').trim();
  const warn = esc([note, 'Не пересылайте этот документ и не храните его в открытом виде.'].filter(Boolean).join(' '));
  const support = String(profile.support || '').trim();
  const supportHtml = support
    ? `<div class="support"><div class="support-title">Поддержка</div>${esc(support).replace(/\n/g, '<br>')}</div>`
    : '';
  return `<header class="head">${brand}<div class="date">${esc(formatDate(date))}</div></header>
<div class="kicker">Доступы к рабочим системам</div>
<h1 class="fio">${esc(fio)}</h1>
${accounts.map(card).join('\n')}
<footer class="foot"><div class="warn">${warn}</div>${supportHtml}</footer>`;
}

module.exports = { buildPdfHtml, esc };
