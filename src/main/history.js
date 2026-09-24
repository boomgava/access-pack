'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// История выданных архивов: что кому собрали и с каким паролем.
// Лежит рядом с настройками, в открытом виде — как «Пароли.txt», доступ ограничен учёткой ОС.
// Записи старше срока хранения удаляются сами при каждом чтении и записи.

const HISTORY_VERSION = 1;
const DEFAULT_KEEP_DAYS = 90;
const FILE = 'history.json';

function keepFrom(keepDays, now) {
  const days = Number(keepDays) > 0 ? Number(keepDays) : DEFAULT_KEEP_DAYS;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

// Новые сверху; записи без даты считаем свежими, чтобы не терять их молча
function sortNewestFirst(entries) {
  return entries.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

function prune(entries, keepDays, now) {
  const edge = keepFrom(keepDays, now).toISOString();
  return entries.filter((e) => e && typeof e === 'object' && String(e.at || '') >= edge);
}

async function readFile(dir) {
  const file = path.join(dir, FILE);
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { entries: [], warning: null };
    throw e;
  }
  try {
    const parsed = JSON.parse(raw);
    const entries = parsed && Array.isArray(parsed.entries) ? parsed.entries : null;
    if (!entries) throw new Error('нет записей');
    return { entries, warning: null };
  } catch {
    const broken = path.join(dir, `history.broken-${Date.now()}.json`);
    await fsp.rename(file, broken);
    return { entries: [], warning: `Файл истории повреждён и сохранён как ${path.basename(broken)}.` };
  }
}

async function writeFile(dir, entries) {
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, FILE);
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ version: HISTORY_VERSION, entries }, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

async function loadHistory(dir, { keepDays = DEFAULT_KEEP_DAYS, now = new Date() } = {}) {
  const { entries, warning } = await readFile(dir);
  const kept = prune(entries, keepDays, now);
  if (kept.length !== entries.length) await writeFile(dir, kept);
  return { entries: sortNewestFirst(kept), warning };
}

async function appendHistory(dir, newEntries, { keepDays = DEFAULT_KEEP_DAYS, now = new Date() } = {}) {
  const { entries } = await readFile(dir);
  const stamped = newEntries.map((e) => ({ id: e.id || crypto.randomUUID(), at: e.at || now.toISOString(), ...e }));
  const kept = prune([...entries, ...stamped], keepDays, now);
  await writeFile(dir, kept);
  return { entries: sortNewestFirst(kept) };
}

async function deleteHistoryEntry(dir, id) {
  const { entries } = await readFile(dir);
  const kept = entries.filter((e) => e && e.id !== id);
  await writeFile(dir, kept);
  return { entries: sortNewestFirst(kept) };
}

async function clearHistory(dir) {
  await writeFile(dir, []);
  return { entries: [] };
}

module.exports = { loadHistory, appendHistory, deleteHistoryEntry, clearHistory, DEFAULT_KEEP_DAYS };
