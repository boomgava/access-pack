'use strict';
// Сквозная сборка с настоящим PDF: npm run smoke:build -- <папка>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { PdfRenderer } = require('../src/main/pdf');
const { defaultSettings } = require('../src/main/settings');
const { buildBatch } = require('../src/main/build');

const root = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'access-pack-build-'));

app.whenReady().then(async () => {
  const lib = path.join(root, 'lib');
  const out = path.join(root, 'out');
  fs.mkdirSync(path.join(lib, 'ПО'), { recursive: true });
  fs.mkdirSync(out, { recursive: true });
  const rdp = 'full address:s:rds.example.com\r\nprompt for credentials:i:1\r\n';
  fs.writeFileSync(path.join(lib, 'Терминал.rdp'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(rdp, 'utf16le')]));
  fs.writeFileSync(path.join(lib, 'Инструкция VPN.txt'), 'Инструкция');
  fs.writeFileSync(path.join(lib, 'ПО', 'setup.bin'), Buffer.alloc(1024, 7));

  const s = defaultSettings();
  const r = new PdfRenderer();
  try {
    await r.init();
    const res = await buildBatch(
      {
        employees: [
          {
            fio: 'Иванов Иван Иванович',
            accounts: [
              { systemId: 'domain', login: 'ivanov.i', password: 'P@ss-1' },
              { systemId: 'yandex360', login: 'i.ivanov@example.com', password: 'Ya-2' },
            ],
          },
        ],
        attachments: ['Терминал.rdp', 'Инструкция VPN.txt', 'ПО'].map((n) => path.join(lib, n)),
        systems: s.systems,
        profile: s.profiles[0],
        encryption: 'zipcrypto',
        outDir: out,
      },
      { renderPdf: (d) => r.render({ ...d, logoDataUrl: null }) },
    );
    console.log(JSON.stringify(res));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    r.destroy();
    app.quit();
  }
});
