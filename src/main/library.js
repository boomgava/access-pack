'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const { uniqueName } = require('../core/names');

const SERVICE_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

// Скрытые, служебные и временные файлы Office (~$…) в архив не попадают
function isHidden(name) {
  return name.startsWith('.') || name.startsWith('~$') || SERVICE_FILES.has(name.toLowerCase());
}

const byName = (a, b) => a.name.localeCompare(b.name, 'ru');

// Видимое содержимое папки: сначала подпапки, потом файлы, по алфавиту
async function readVisible(dir) {
  const dirents = (await fsp.readdir(dir, { withFileTypes: true })).filter(
    (d) => !isHidden(d.name) && (d.isFile() || d.isDirectory()),
  );
  const dirs = dirents.filter((d) => d.isDirectory()).sort(byName);
  const files = dirents.filter((d) => d.isFile()).sort(byName);
  return [...dirs, ...files].map((d) => ({
    name: d.name,
    path: path.join(dir, d.name),
    kind: d.isDirectory() ? 'dir' : 'file',
  }));
}

const ROOT_GROUP = 'Без раздела';

// Разделы библиотеки: каждая подпапка верхнего уровня (RDP, Инструкции, ПО) —
// свой раздел; файлы, лежащие прямо в библиотеке, собираются в «Без раздела».
// Подпапка второго уровня остаётся одной записью и попадает в архив целиком.
async function listLibrary(dir) {
  if (!dir) return { groups: [], error: 'Папка библиотеки не выбрана' };
  let top;
  try {
    top = await readVisible(dir);
  } catch {
    return { groups: [], error: 'Папка не найдена' };
  }
  const groups = [];
  for (const entry of top.filter((e) => e.kind === 'dir')) {
    const items = await readVisible(entry.path);
    if (items.length) groups.push({ name: entry.name, path: entry.path, items });
  }
  const rootFiles = top.filter((e) => e.kind === 'file');
  if (rootFiles.length) groups.push({ name: ROOT_GROUP, path: dir, items: rootFiles });
  return { groups, error: null };
}

async function walk(dir, zipDir, entries) {
  entries.push({ zipPath: `${zipDir}/`, srcPath: dir, kind: 'dir' });
  const dirents = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => !isHidden(d.name)).sort(byName);
  for (const d of dirents) {
    const src = path.join(dir, d.name);
    const zp = `${zipDir}/${d.name}`;
    if (d.isDirectory()) await walk(src, zp, entries);
    else if (d.isFile()) entries.push({ zipPath: zp, srcPath: src, kind: 'file' });
  }
}

// Список записей архива из отмеченных вложений (файлы и папки целиком)
async function collectEntries(paths) {
  const taken = new Set();
  const entries = [];
  for (const p of paths) {
    const st = await fsp.stat(p);
    const top = uniqueName(path.basename(p), taken);
    if (st.isDirectory()) await walk(p, top, entries);
    else entries.push({ zipPath: top, srcPath: p, kind: 'file' });
  }
  return entries;
}

module.exports = { listLibrary, collectEntries, isHidden };
