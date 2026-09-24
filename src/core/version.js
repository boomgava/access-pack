'use strict';

// Сравнение версий вида 1.4.0 и разбор ответа GitHub о последнем релизе.
// Логика чистая и покрыта тестами: ошибиться тут — значит предлагать «обновление» на старое.

// -1 / 0 / 1; предрелизы (1.5.0-beta.1) считаем младше релиза 1.5.0
function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre = ''] = String(v || '').trim().replace(/^v/i, '').split('-');
    return { nums: core.split('.').map((n) => Number(n) || 0), pre };
  };
  const left = split(a);
  const right = split(b);
  for (let i = 0; i < 3; i++) {
    const diff = (left.nums[i] || 0) - (right.nums[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre > right.pre ? 1 : -1;
}

const isNewer = (candidate, current) => compareVersions(candidate, current) > 0;

// Из ответа GitHub оставляем только нужное: версию, ссылку на страницу релиза и описание
function parseRelease(json, currentVersion) {
  if (!json || typeof json !== 'object') return null;
  if (json.draft) return null;
  const latest = String(json.tag_name || json.name || '').trim().replace(/^v/i, '');
  if (!latest) return null;
  const files = (Array.isArray(json.assets) ? json.assets : [])
    .filter((a) => a && a.name && a.browser_download_url)
    .map((a) => ({ name: a.name, url: a.browser_download_url, size: Number(a.size) || 0 }));
  return {
    latest,
    current: String(currentVersion || ''),
    newer: isNewer(latest, currentVersion),
    prerelease: Boolean(json.prerelease),
    url: json.html_url || '',
    notes: String(json.body || '').trim(),
    files,
  };
}

// Имя файла под текущую систему, чтобы не заставлять выбирать вручную
function pickFile(files, { platform = process.platform, arch = process.arch } = {}) {
  const list = Array.isArray(files) ? files : [];
  const want = platform === 'win32'
    ? [/\.exe$/i]
    : platform === 'darwin'
      ? [arch === 'arm64' ? /arm64.*\.dmg$/i : /x64.*\.dmg$/i, /\.dmg$/i]
      : [/\.AppImage$/i, /\.deb$/i];
  for (const rule of want) {
    const found = list.find((f) => rule.test(f.name));
    if (found) return found;
  }
  return null;
}

module.exports = { compareVersions, isNewer, parseRelease, pickFile };
