'use strict';
// Образцы PDF: npm run smoke:pdf -- <папка>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const { PdfRenderer } = require('../src/main/pdf');
const { defaultSettings } = require('../src/main/settings');

const outDir = process.argv[2] || path.join(os.tmpdir(), 'access-pack-smoke');
const s = defaultSettings();
const sys = Object.fromEntries(s.systems.map((x) => [x.id, x]));
const profile = {
  ...s.profiles[0],
  support: 'Техподдержка: +7 (495) 000-00-00, доб. 123\nhelp@example.com',
};

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const r = new PdfRenderer();
  try {
    await r.init();
    const one = await r.render({
      fio: 'Петрова Анна Сергеевна',
      date: new Date(),
      profile,
      logoDataUrl: null,
      accounts: [{ system: sys.domain, login: 'company\\petrova.a', password: 'Wd8e-Hb3n-Ry6k' }],
    });
    fs.writeFileSync(path.join(outDir, 'sample-1.pdf'), one);
    const four = await r.render({
      fio: 'Константинопольский Александр Владимирович',
      date: new Date(),
      profile,
      logoDataUrl: null,
      accounts: [
        { system: sys.domain, login: 'company\\konstantinopolskiy.a', password: 'Kq7m-Xp4r-Tz9w' },
        { system: sys.mail, login: 'company\\konstantinopolskiy.a', password: 'Kq7m-Xp4r-Tz9w' },
        { system: sys.yandex360, login: 'a.konstantinopolskiy@example.com', password: 'l1I0Oo-проверка' },
        { system: { ...sys.intraservice, url: 'https://intraservice.example.com' }, login: 'konstantinopolskiy.a', password: 'Is-2026!' },
        { system: sys.m365, login: 'a.konstantinopolskiy@example.org', password: 'M365-Xk7m' },
      ],
    });
    fs.writeFileSync(path.join(outDir, 'sample-4.pdf'), four);
    console.log(`OK ${outDir}`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    r.destroy();
    app.quit();
  }
});
