'use strict';

// Перенос настроек между компьютерами: файл с настройками и логотипами.
// Пароль почты в файл не попадает — он лежит в ключнице ОС и не экспортируется.

const MARKER = 'access-pack-settings';

// Личные поля: у коллеги свои папки и своя почта
const LOCAL_KEYS = ['libraryPath', 'outputPath'];
const PERSONAL_MAIL_KEYS = ['user', 'from', 'fromName', 'cc'];

function buildExport(settings, { files = {}, now = new Date(), appVersion = '' } = {}) {
  const clean = { ...settings };
  delete clean.mail?.password; // на всякий случай: пароля в настройках и так нет
  return {
    marker: MARKER,
    exportedAt: now.toISOString(),
    appVersion: String(appVersion || ''),
    settings: clean,
    files, // имя файла логотипа → data URL
  };
}

function parseImport(raw) {
  let json = raw;
  if (typeof raw === 'string') {
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'Это не файл настроек: не получилось прочитать JSON' };
    }
  }
  if (!json || typeof json !== 'object' || json.marker !== MARKER) {
    return { ok: false, error: 'Это не файл настроек «Пакета доступов»' };
  }
  const settings = json.settings;
  if (!settings || typeof settings !== 'object') return { ok: false, error: 'В файле нет настроек' };
  const systems = Array.isArray(settings.systems) ? settings.systems : [];
  const profiles = Array.isArray(settings.profiles) ? settings.profiles : [];
  if (!systems.length && !profiles.length) return { ok: false, error: 'В файле нет ни систем, ни профилей' };
  const files = json.files && typeof json.files === 'object' ? json.files : {};
  return {
    ok: true,
    settings,
    files,
    exportedAt: String(json.exportedAt || ''),
    appVersion: String(json.appVersion || ''),
    summary: {
      systems: systems.length,
      profiles: profiles.length,
      logos: Object.keys(files).length,
      mail: Boolean(settings.mail && settings.mail.host),
      paths: LOCAL_KEYS.some((k) => settings[k]),
    },
  };
}

// mode: 'all' — принять файл целиком (перенос на свой новый компьютер),
// 'shared' — взять общее (системы, профили, шаблон письма, вид), а свои папки
// и свои адреса почты оставить как есть.
function mergeImported(current, imported, { mode = 'shared' } = {}) {
  const next = { ...current, ...imported };
  next.version = current.version;
  if (mode === 'all') return next;

  for (const key of LOCAL_KEYS) next[key] = current[key];
  const mail = { ...(current.mail || {}), ...(imported.mail || {}) };
  for (const key of PERSONAL_MAIL_KEYS) mail[key] = (current.mail || {})[key] || '';
  next.mail = mail;
  return next;
}

module.exports = { buildExport, parseImport, mergeImported, MARKER, LOCAL_KEYS, PERSONAL_MAIL_KEYS };
