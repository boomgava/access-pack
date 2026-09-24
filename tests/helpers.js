'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Независимый «оракул»: Python zipfile читает ZipCrypto (AES не умеет — для него 7zz)
const PY = `
import zipfile, sys, json, base64
z = zipfile.ZipFile(sys.argv[1])
z.setpassword(sys.argv[2].encode())
with_data = sys.argv[3] == '1'
out = []
for i in z.infolist():
    data = None
    if with_data and not i.is_dir():
        data = base64.b64encode(z.read(i)).decode()
    out.append({'name': i.filename, 'flags': i.flag_bits, 'method': i.compress_type, 'data': data})
print(json.dumps(out))
`;

function readZipPy(file, password, { data = true } = {}) {
  const out = execFileSync('python3', ['-c', PY, file, password, data ? '1' : '0'], {
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out).map((e) => ({ ...e, data: e.data === null ? null : Buffer.from(e.data, 'base64') }));
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'access-pack-'));
}

function which(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// .rdp в том виде, как его сохраняет mstsc: UTF-16 LE с BOM
function utf16rdp(text) {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

module.exports = { readZipPy, tmpDir, which, utf16rdp };
