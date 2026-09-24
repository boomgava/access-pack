'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Файлы главного процесса и renderer не подключаются в тестах напрямую (им нужен electron),
// поэтому синтаксис проверяем отдельно: одна опечатка в них роняет всё приложение при запуске.
function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(p);
    return e.isFile() && p.endsWith('.js') ? [p] : [];
  });
}

test('все файлы программы разбираются без синтаксических ошибок', () => {
  const root = path.join(__dirname, '..');
  const files = ['src', 'scripts'].flatMap((d) => jsFiles(path.join(root, d)));
  assert.ok(files.length > 15, `файлов найдено: ${files.length}`);
  for (const file of files) {
    assert.doesNotThrow(
      () => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }),
      `синтаксическая ошибка: ${path.relative(root, file)}`,
    );
  }
});
