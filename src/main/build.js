'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const { generateArchivePassword } = require('../core/password');
const { archiveBaseName, pdfName, uniqueName, batchFolderName, memoFolderName } = require('../core/names');
const { fullLogin } = require('../core/login');
const { setRdpUsername } = require('../core/rdp');
const { formatPasswordsTxt } = require('../core/passwords-txt');
const { ZipWriter } = require('../core/zip/writer');
const { collectEntries } = require('./library');

// Проверка до старта: вложения на месте, в папку вывода можно писать
async function preflight({ attachments, outDir }) {
  const errors = [];
  for (const p of attachments) {
    try {
      await fsp.stat(p);
    } catch {
      errors.push({ field: 'attachment', path: p, message: `Файл не найден: ${path.basename(p)}` });
    }
  }
  try {
    if (!outDir) throw new Error('пусто');
    const st = await fsp.stat(outDir);
    if (!st.isDirectory()) throw new Error('не папка');
    // Пробная запись: access(W_OK) на Windows ненадёжен
    const probe = path.join(outDir, `.access-pack-probe-${process.pid}`);
    await fsp.writeFile(probe, '');
    await fsp.rm(probe, { force: true });
  } catch {
    errors.push({ field: 'outDir', message: `Нет доступа на запись в папку: ${outDir || 'не выбрана'}` });
  }
  return errors;
}

async function makeBatchFolder(outDir, now, nameOf = batchFolderName) {
  const base = nameOf(now);
  for (let i = 1; ; i++) {
    const dir = path.join(outDir, i === 1 ? base : `${base}_${i}`);
    try {
      await fsp.mkdir(dir);
      return dir;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

async function buildOne({ emp, archivePath, password, entries, bySystem, profile, encryption, now, renderPdf }) {
  const fio = emp.fio.trim();
  const accounts = emp.accounts.map((a) => {
    const system = bySystem.get(a.systemId);
    if (!system) throw new Error('Система учётки не найдена в справочнике');
    return { system, login: fullLogin(a.login, system), password: a.password };
  });
  const pdf = await renderPdf({ fio, date: now, profile, accounts });
  const rdpLogin = accounts.find((a) => a.system.rdp)?.login;

  const writer = await ZipWriter.create(archivePath, { password, method: encryption });
  try {
    await writer.addBuffer(pdfName(fio), pdf, now);
    for (const e of entries) {
      if (e.kind === 'dir') {
        await writer.addDirectory(e.zipPath);
      } else if (rdpLogin && /\.rdp$/i.test(e.zipPath)) {
        await writer.addBuffer(e.zipPath, setRdpUsername(await fsp.readFile(e.srcPath), rdpLogin), now);
      } else {
        await writer.addFile(e.zipPath, e.srcPath);
      }
    }
    await writer.close();
  } catch (err) {
    await writer.abort();
    throw err;
  }
}

async function buildBatch(input, { renderPdf, onProgress = () => {} }) {
  const { employees, attachments, systems, profile, encryption, outDir, now = new Date() } = input;
  const bySystem = new Map(systems.map((s) => [s.id, s]));
  const folder = await makeBatchFolder(outDir, now);
  const entries = await collectEntries(attachments);
  const taken = new Set();
  const results = [];

  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const fio = emp.fio.trim();
    const archive = uniqueName(`${archiveBaseName(fio)}.zip`, taken);
    const password = generateArchivePassword();
    try {
      await buildOne({
        emp,
        archivePath: path.join(folder, archive),
        password,
        entries,
        bySystem,
        profile,
        encryption,
        now,
        renderPdf,
      });
      results.push({ fio, archive, password, error: null });
    } catch (err) {
      results.push({ fio, archive, password: null, error: err.message });
    }
    onProgress({ done: i + 1, total: employees.length });
  }

  const passwordsFile = path.join(folder, 'Пароли.txt');
  await fsp.writeFile(passwordsFile, formatPasswordsTxt({ date: now, encryption, results }));
  return { folder, passwordsFile, results };
}

// Только памятки: PDF на каждого сотрудника, без архивов, паролей и вложений
async function buildMemos(input, { renderPdf, onProgress = () => {} }) {
  const { employees, systems, profile, outDir, now = new Date() } = input;
  const bySystem = new Map(systems.map((s) => [s.id, s]));
  const folder = await makeBatchFolder(outDir, now, memoFolderName);
  const taken = new Set();
  const results = [];
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const fio = emp.fio.trim();
    const file = uniqueName(pdfName(fio), taken);
    try {
      const accounts = emp.accounts.map((a) => {
        const system = bySystem.get(a.systemId);
        if (!system) throw new Error('Система учётки не найдена в справочнике');
        return { system, login: fullLogin(a.login, system), password: a.password };
      });
      const pdf = await renderPdf({ fio, date: now, profile, accounts });
      await fsp.writeFile(path.join(folder, file), pdf);
      results.push({ fio, file, error: null });
    } catch (err) {
      results.push({ fio, file, error: err.message });
    }
    onProgress({ done: i + 1, total: employees.length });
  }
  return { folder, results };
}

module.exports = { preflight, buildBatch, buildMemos };
