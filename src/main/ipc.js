'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, ipcMain, dialog, shell, clipboard } = require('electron');
const { loadSettings, saveSettings, importLogo, logoDataUrl, importBackground, backgroundDataUrl } = require('./settings');
const { loadHistory, appendHistory, deleteHistoryEntry, clearHistory } = require('./history');
const { listLibrary } = require('./library');
const { mascots, mascotDataUrl } = require('./themes');
const { preflight, buildBatch, buildMemos } = require('./build');
const { PdfRenderer } = require('./pdf');
const { validateBatch } = require('../core/validate');
const { historyEntries } = require('../core/history-entry');
const { renderTemplate } = require('../core/mail-text');
const { sendMail, testConnection } = require('./smtp');
const { saveSecret, readSecret, hasSecret, available } = require('./secrets');
const { checkForUpdate } = require('./updater');
const { buildExport, parseImport, mergeImported } = require('../core/settings-transfer');

function registerIpc({ getWindow, setDirty }) {
  const dir = app.getPath('userData');
  const defaults = { outputPath: app.getPath('desktop') };
  let building = false;

  ipcMain.handle('settings:load', () => loadSettings(dir, defaults));
  ipcMain.handle('settings:save', async (_e, settings) => {
    await saveSettings(dir, settings);
    return true;
  });
  ipcMain.handle('settings:importLogo', (_e, srcPath) => importLogo(dir, srcPath));
  ipcMain.handle('settings:logoPreview', (_e, logoFile) => logoDataUrl(dir, logoFile));
  ipcMain.handle('settings:importBackground', (_e, srcPath) => importBackground(dir, srcPath));
  ipcMain.handle('settings:backgroundPreview', (_e, file) => backgroundDataUrl(dir, file));
  ipcMain.handle('themes:mascots', () => mascots());
  ipcMain.handle('themes:mascotImage', (_e, id) => mascotDataUrl(id));
  ipcMain.handle('library:list', (_e, libDir) => listLibrary(libDir));

  ipcMain.handle('dialog:pickFolder', async (_e, defaultPath) => {
    const r = await dialog.showOpenDialog(getWindow(), {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultPath || undefined,
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:pickFiles', async () => {
    const r = await dialog.showOpenDialog(getWindow(), { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('dialog:pickImage', async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'svg'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('shell:openLink', async (_e, url) => {
    // открываем только ссылки на релизы, чтобы из renderer нельзя было запустить что угодно
    if (/^https:\/\/github\.com\//i.test(String(url))) await shell.openExternal(String(url));
    return true;
  });
  ipcMain.handle('shell:openFolder', async (_e, p) => {
    await shell.openPath(p);
  });
  ipcMain.handle('clipboard:write', (_e, text) => {
    clipboard.writeText(String(text));
    return true;
  });
  ipcMain.on('batch:dirty', (_e, value) => setDirty(Boolean(value)));

  ipcMain.handle('history:list', async () => {
    const { settings } = await loadSettings(dir, defaults);
    return loadHistory(dir, { keepDays: settings.historyDays });
  });
  ipcMain.handle('history:delete', (_e, id) => deleteHistoryEntry(dir, id));

  ipcMain.handle('update:check', () => checkForUpdate());

  // Перенос настроек: файл с настройками и логотипами, без пароля почты
  ipcMain.handle('settings:export', async () => {
    const { settings } = await loadSettings(dir, defaults);
    const { canceled, filePath } = await dialog.showSaveDialog(getWindow(), {
      title: 'Экспорт настроек',
      defaultPath: `Пакет доступов — настройки ${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Настройки', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    const files = {};
    for (const profile of settings.profiles || []) {
      if (!profile.logoFile) continue;
      const url = await logoDataUrl(dir, profile.logoFile);
      if (url) files[profile.logoFile] = url;
    }
    const payload = buildExport(settings, { files, appVersion: app.getVersion() });
    await fsp.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, filePath, logos: Object.keys(files).length };
  });

  ipcMain.handle('settings:importRead', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getWindow(), {
      title: 'Импорт настроек',
      properties: ['openFile'],
      filters: [{ name: 'Настройки', extensions: ['json'] }],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };
    try {
      const res = parseImport(await fsp.readFile(filePaths[0], 'utf8'));
      return res.ok ? { ...res, filePath: filePaths[0] } : res;
    } catch (e) {
      return { ok: false, error: `Файл не прочитался: ${e.message}` };
    }
  });

  // Применяем уже разобранный файл: логотипы кладём в папку данных
  ipcMain.handle('settings:importApply', async (_e, { settings: incoming, files = {}, mode }) => {
    const { settings: current } = await loadSettings(dir, defaults);
    for (const [name, url] of Object.entries(files)) {
      const match = /^data:[^;]+;base64,(.+)$/.exec(String(url));
      if (!match) continue;
      const logos = path.join(dir, 'logos');
      await fsp.mkdir(logos, { recursive: true });
      await fsp.writeFile(path.join(logos, path.basename(name)), Buffer.from(match[1], 'base64'));
    }
    const next = mergeImported(current, incoming, { mode });
    await saveSettings(dir, next);
    return { ok: true, settings: next };
  });
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('mail:savePassword', (_e, value) => saveSecret(dir, 'smtp', value));
  ipcMain.handle('mail:hasPassword', () => hasSecret(dir, 'smtp'));
  ipcMain.handle('mail:keychainReady', () => available());
  ipcMain.handle('mail:test', async () => {
    const { settings } = await loadSettings(dir, defaults);
    const mail = settings.mail || {};
    try {
      const res = await testConnection({ ...mail, password: await readSecret(dir, 'smtp') });
      return { ok: true, capabilities: res.capabilities };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // Одно письмо за вызов: renderer показывает статус по каждому сотруднику отдельно
  ipcMain.handle('mail:send', async (_e, req) => {
    const { settings } = await loadSettings(dir, defaults);
    const mail = settings.mail || {};
    const from = { email: (mail.from || mail.user || '').trim(), name: (mail.fromName || '').trim() };
    try {
      if (!req.to) throw new Error('Не указан адрес получателя');
      const files = req.attachments || (req.folder && req.archive ? [path.join(req.folder, req.archive)] : []);
      const attachments = [];
      for (const file of files) {
        attachments.push({
          filename: path.basename(file),
          content: await fsp.readFile(file),
          contentType: file.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/zip',
        });
      }
      const text = renderTemplate(mail.template, { fio: req.fio, archive: req.archive });
      const res = await sendMail({
        ...mail,
        password: await readSecret(dir, 'smtp'),
        from,
        to: req.to,
        cc: mail.cc,
        subject: renderTemplate(mail.subject, { fio: req.fio, archive: req.archive }),
        text,
        attachments,
      });
      return { ok: true, recipients: res.recipients };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('history:clear', () => clearHistory(dir));

  ipcMain.handle('memos:run', async (event, req) => {
    if (building) throw new Error('Сборка уже идёт');
    building = true;
    const renderer = new PdfRenderer();
    try {
      const { settings } = await loadSettings(dir, defaults);
      const invalid = validateBatch(req.employees, settings.systems);
      if (invalid.length) return { ok: false, errors: invalid };
      const errors = await preflight({ attachments: [], outDir: req.outDir });
      if (errors.length) return { ok: false, errors };
      const profile = settings.profiles.find((p) => p.id === req.profileId) || settings.profiles[0];
      const logo = await logoDataUrl(dir, profile.logoFile);
      await renderer.init();
      const result = await buildMemos(
        { employees: req.employees, systems: settings.systems, profile, outDir: req.outDir },
        {
          renderPdf: (data) => renderer.render({ ...data, logoDataUrl: logo }),
          onProgress: (p) => event.sender.send('build:progress', p),
        },
      );
      return { ok: true, memos: true, ...result };
    } finally {
      renderer.destroy();
      building = false;
    }
  });

  ipcMain.handle('build:run', async (event, req) => {
    if (building) throw new Error('Сборка уже идёт');
    building = true;
    const renderer = new PdfRenderer();
    try {
      const { settings } = await loadSettings(dir, defaults);
      const invalid = validateBatch(req.employees, settings.systems);
      if (invalid.length) return { ok: false, errors: invalid };
      const errors = await preflight({ attachments: req.attachments, outDir: req.outDir });
      if (errors.length) return { ok: false, errors };

      const profile = settings.profiles.find((p) => p.id === req.profileId) || settings.profiles[0];
      const logo = await logoDataUrl(dir, profile.logoFile);
      await renderer.init();
      const result = await buildBatch(
        {
          employees: req.employees,
          attachments: req.attachments,
          systems: settings.systems,
          profile,
          encryption: req.encryption,
          outDir: req.outDir,
        },
        {
          renderPdf: (data) => renderer.render({ ...data, logoDataUrl: logo }),
          onProgress: (p) => event.sender.send('build:progress', p),
        },
      );
      await remember({ req, settings, result });
      return { ok: true, ...result };
    } finally {
      renderer.destroy();
      building = false;
    }
  });

  // Записываем выданные архивы в историю. Сборка уже состоялась, поэтому
  // ошибка записи не должна её ронять — просто пишем в лог.
  async function remember({ req, settings, result }) {
    try {
      const entries = historyEntries({
        results: result.results,
        employees: req.employees,
        systems: settings.systems,
        attachments: req.attachments,
        folder: result.folder,
        encryption: req.encryption,
      });
      if (entries.length) await appendHistory(dir, entries, { keepDays: settings.historyDays });
    } catch (e) {
      console.error('История не записана:', e.message);
    }
  }
}

module.exports = { registerIpc };
