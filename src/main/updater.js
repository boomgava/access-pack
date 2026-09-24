'use strict';
const https = require('node:https');
const { app } = require('electron');
const { parseRelease, pickFile } = require('../core/version');
const pkg = require('../../package.json');

// Проверка обновлений через релизы GitHub. Программа ничего не скачивает и не
// подменяет себя сама: на macOS автообновление требует подписи Apple Developer ID,
// поэтому честнее показать «вышла версия X» и открыть страницу релиза.

const TIMEOUT = 8000;

// «https://github.com/boomgava/access-pack.git» → «boomgava/access-pack»
function repoSlug() {
  const url = String((pkg.repository && pkg.repository.url) || pkg.repository || '');
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  return match ? `${match[1]}/${match[2]}` : '';
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': `AccessPack/${pkg.version}`,
          Accept: 'application/vnd.github+json',
        },
        timeout: TIMEOUT,
      },
      (res) => {
        if (res.statusCode === 404) {
          res.resume();
          reject(new Error('Релизов пока нет'));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GitHub ответил ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Непонятный ответ GitHub'));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('GitHub не ответил за 8 секунд')));
    req.on('error', (e) => reject(new Error(e.message)));
  });
}

async function checkForUpdate() {
  const slug = repoSlug();
  if (!slug) return { ok: false, error: 'В package.json не указан адрес репозитория' };
  const current = app.getVersion();
  try {
    const json = await getJson(`https://api.github.com/repos/${slug}/releases/latest`);
    const info = parseRelease(json, current);
    if (!info) return { ok: true, newer: false, current, latest: current };
    return { ok: true, ...info, file: pickFile(info.files) };
  } catch (e) {
    return { ok: false, error: e.message, current };
  }
}

module.exports = { checkForUpdate, repoSlug };
