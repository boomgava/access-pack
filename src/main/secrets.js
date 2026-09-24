'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const { safeStorage } = require('electron');

// Пароль от почты не должен лежать в settings.json открытым текстом,
// поэтому шифруем его средствами ОС: Keychain на macOS, DPAPI на Windows.

const FILE = 'secrets.bin';

async function readAll(dir) {
  try {
    const raw = await fsp.readFile(path.join(dir, FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAll(dir, data) {
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, FILE);
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fsp.rename(tmp, file);
}

function available() {
  return safeStorage.isEncryptionAvailable();
}

// Пустое значение стирает пароль
async function saveSecret(dir, name, value) {
  const data = await readAll(dir);
  if (!value) {
    delete data[name];
  } else {
    if (!available()) throw new Error('Система не даёт зашифровать пароль — ключница недоступна');
    data[name] = safeStorage.encryptString(String(value)).toString('base64');
  }
  await writeAll(dir, data);
  return Boolean(value);
}

async function readSecret(dir, name) {
  const data = await readAll(dir);
  if (!data[name]) return '';
  try {
    return safeStorage.decryptString(Buffer.from(data[name], 'base64'));
  } catch {
    return '';
  }
}

async function hasSecret(dir, name) {
  const data = await readAll(dir);
  return Boolean(data[name]);
}

module.exports = { saveSecret, readSecret, hasSecret, available };
