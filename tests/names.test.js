'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeFileName, archiveBaseName, pdfName, uniqueName, batchFolderName } = require('../src/core/names');
const { formatDate, formatDateTime } = require('../src/core/format');

test('sanitizeFileName убирает запрещённые в Windows символы', () => {
  assert.equal(sanitizeFileName('Ив:ан*ов?'), 'Иванов');
  assert.equal(sanitizeFileName('a<b>c|d"e/f\\g'), 'abcdefg');
  assert.equal(sanitizeFileName('  a   b  '), 'a b');
  assert.equal(sanitizeFileName('Имя. . '), 'Имя');
  assert.equal(sanitizeFileName('таб\tи\u0001управл'), 'табиуправл');
});

test('sanitizeFileName: пустое имя → «Сотрудник»', () => {
  assert.equal(sanitizeFileName(''), 'Сотрудник');
  assert.equal(sanitizeFileName('<>'), 'Сотрудник');
});

test('archiveBaseName — фамилия и имя через подчёркивание', () => {
  assert.equal(archiveBaseName('Иванов Иван Иванович'), 'Иванов_Иван');
  assert.equal(archiveBaseName('  Петрова   Анна '), 'Петрова_Анна');
  assert.equal(archiveBaseName('Мадонна'), 'Мадонна');
  assert.equal(archiveBaseName('??? Иван'), 'Иван');
  assert.equal(archiveBaseName(''), 'Сотрудник');
});

test('pdfName — «Доступы — Фамилия И.О.pdf»', () => {
  assert.equal(pdfName('Иванов Иван Иванович'), 'Доступы — Иванов И.И.pdf');
  assert.equal(pdfName('Петрова Анна'), 'Доступы — Петрова А.pdf');
  assert.equal(pdfName('Мадонна'), 'Доступы — Мадонна.pdf');
  assert.equal(pdfName('иванов иван'), 'Доступы — иванов И.pdf');
});

test('uniqueName добавляет _2, _3 без учёта регистра', () => {
  const taken = new Set();
  assert.equal(uniqueName('a.zip', taken), 'a.zip');
  assert.equal(uniqueName('a.zip', taken), 'a_2.zip');
  assert.equal(uniqueName('A.ZIP', taken), 'A_3.ZIP');
  assert.equal(uniqueName('Папка', taken), 'Папка');
  assert.equal(uniqueName('папка', taken), 'папка_2');
});

test('batchFolderName и форматы дат', () => {
  const d = new Date(2026, 8, 2, 5, 7);
  assert.equal(batchFolderName(d), 'Доступы_2026-09-02_05-07');
  assert.equal(formatDate(d), '02.09.2026');
  assert.equal(formatDateTime(d), '02.09.2026 05:07');
});
