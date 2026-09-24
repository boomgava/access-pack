'use strict';
const path = require('node:path');
const { pad } = require('./format');

// Запрещено в именах файлов Windows + управляющие символы
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

function sanitizeFileName(name) {
  const cleaned = String(name)
    .replace(FORBIDDEN, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || 'Сотрудник';
}

function fioWords(fio) {
  return String(fio).trim().split(/\s+/).filter(Boolean);
}

// «Иванов Иван Иванович» → «Иванов_Иван»
function archiveBaseName(fio) {
  return sanitizeFileName(fioWords(fio).slice(0, 2).join(' ')).replace(/ /g, '_');
}

// «Иванов Иван Иванович» → «Доступы — Иванов И.И.pdf»
function pdfName(fio) {
  const [surname = '', ...rest] = fioWords(fio);
  const initials = rest
    .slice(0, 2)
    .map((w) => `${Array.from(w)[0].toUpperCase()}.`)
    .join('');
  const who = [surname, initials].filter(Boolean).join(' ');
  return `${sanitizeFileName(`Доступы — ${who}`)}.pdf`;
}

// Уникальное имя в пределах набора; сравнение без учёта регистра (как в Windows)
function uniqueName(name, taken) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base}_${i}${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function batchFolderName(d) {
  return `Доступы_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

// Папка для памяток без архивов
function memoFolderName(d) {
  return `Памятки_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

module.exports = { sanitizeFileName, archiveBaseName, pdfName, uniqueName, batchFolderName, memoFolderName };
