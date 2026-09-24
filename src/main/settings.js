'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_SYSTEMS = [
  {
    id: 'domain',
    name: 'Домен (Windows / RDP)',
    url: '',
    domainPrefix: 'company\\',
    rdp: true,
    steps: ['Откройте файл подключения .rdp из архива', 'Логин уже подставлен — введите пароль из этого документа'],
  },
  {
    id: 'mail',
    name: 'Корпоративная почта (Exchange)',
    url: 'https://mail.example.com/owa',
    domainPrefix: 'company\\',
    rdp: false,
    steps: [
      'Почта в браузере — по адресу выше',
      'Логин и пароль те же, что у доменной учётной записи',
      'Почта на телефоне и компьютере настраивается по инструкциям из архива',
    ],
  },
  {
    id: 'yandex360',
    name: 'Яндекс 360',
    url: 'https://mail.yandex.ru',
    domainPrefix: '',
    rdp: false,
    steps: ['Откройте адрес и нажмите «Войти»', 'Введите логин (полный адрес почты) и пароль', 'Если попросят — смените пароль'],
  },
  {
    id: 'intraservice',
    name: 'IntraService',
    url: '',
    domainPrefix: '',
    rdp: false,
    steps: ['Откройте адрес', 'Введите логин и пароль'],
  },
  {
    id: 'm365',
    name: 'Microsoft 365',
    url: 'https://www.office.com',
    domainPrefix: '',
    rdp: false,
    steps: [
      'Откройте адрес и нажмите «Войти»',
      'Введите логин (адрес почты) и пароль',
      'При первом входе смените пароль и настройте подтверждение входа, если попросят',
    ],
  },
];

const DEFAULT_PROFILES = [
  {
    id: 'main',
    name: 'Основной',
    company: 'Компания',
    logoFile: '',
    support: '',
    note: 'Пароль нужно сменить при первом входе.',
  },
];

const { DEFAULT_KEEP_DAYS } = require('./history');

const LOGO_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };

// Письмо по умолчанию: текст, которым доступы рассылались вручную.
// Подстановки: {ФИО}, {Имя}, {Архив}
const DEFAULT_MAIL = {
  host: '',
  port: 587,
  security: 'starttls',
  user: '',
  from: '',
  fromName: '',
  cc: '',
  subject: 'Доступы к рабочим системам',
  template: [
    'Доброго дня!',
    'Направляю Вам зашифрованный архив с учётной записью и инструкциями.',
    'Пароль от архива сообщу отдельно — напишите мне, пожалуйста.',
    '',
    'После получения письма нужно в течение суток подключиться к VPN, сменить пароль и настроить второй фактор.',
    'Иначе доступ отключат, и потребуется повторный запрос.',
  ].join('\n'),
  sendAfterBuild: false,
};

const SETTINGS_VERSION = 3;
// Текст, который раньше стоял в шагах домена: смена пароля происходит не при входе по RDP,
// а при первом входе в VPN. Убираем его только у тех, кто шаги не правил.
const OUTDATED_DOMAIN_STEP = 'При первом входе система попросит сменить пароль';

// Настройки лежат у пользователя и переживают обновление программы: новые системы
// из умолчаний надо доложить в уже сохранённый файл, ничего в нём не затирая.
function migrate(settings) {
  if (Number(settings.version) >= SETTINGS_VERSION) return settings;
  const systems = Array.isArray(settings.systems) ? settings.systems.map((s) => ({ ...s })) : [];
  const ids = new Set(systems.map((s) => s && s.id));
  for (const def of DEFAULT_SYSTEMS) if (!ids.has(def.id)) systems.push(structuredClone(def));
  for (const s of systems) {
    if (Array.isArray(s.steps)) s.steps = s.steps.filter((step) => step !== OUTDATED_DOMAIN_STEP);
  }
  const mail = { ...structuredClone(DEFAULT_MAIL), ...(settings.mail || {}) };
  const profiles = (Array.isArray(settings.profiles) ? settings.profiles : []).map((p) => ({
    note: DEFAULT_PROFILES[0].note,
    ...p,
  }));
  return { ...settings, systems, mail, profiles: profiles.length ? profiles : structuredClone(DEFAULT_PROFILES), version: SETTINGS_VERSION };
}

function defaultSettings({ outputPath = '' } = {}) {
  return {
    version: SETTINGS_VERSION,
    libraryPath: '',
    outputPath,
    encryption: 'zipcrypto',
    defaultProfileId: 'main',
    historyDays: DEFAULT_KEEP_DAYS,
    checkUpdates: true,
    theme: 'system',
    mascot: '',
    mascotOpacity: 85,
    backgroundFile: '',
    backgroundDim: 55,
    mail: structuredClone(DEFAULT_MAIL),
    systems: structuredClone(DEFAULT_SYSTEMS),
    profiles: structuredClone(DEFAULT_PROFILES),
  };
}

async function loadSettings(dir, { outputPath } = {}) {
  const file = path.join(dir, 'settings.json');
  const defaults = defaultSettings({ outputPath });
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { settings: defaults, warning: null };
    throw e;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('не объект');
    return { settings: migrate({ ...defaults, ...parsed }), warning: null };
  } catch {
    const broken = path.join(dir, `settings.broken-${Date.now()}.json`);
    await fsp.rename(file, broken);
    return {
      settings: defaults,
      warning: `Файл настроек повреждён и сохранён как ${path.basename(broken)}. Загружены настройки по умолчанию.`,
    };
  }
}

async function saveSettings(dir, settings) {
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

async function importImage(dir, srcPath, { subdir, prefix, what }) {
  const ext = path.extname(srcPath).toLowerCase();
  if (!LOGO_MIME[ext]) throw new Error(`${what} должен быть PNG, JPG или SVG`);
  const target = path.join(dir, subdir);
  await fsp.mkdir(target, { recursive: true });
  const name = `${prefix}-${Date.now()}${ext}`;
  await fsp.copyFile(srcPath, path.join(target, name));
  return name;
}

async function imageDataUrl(dir, subdir, file) {
  if (!file) return null;
  const name = path.basename(file);
  const mime = LOGO_MIME[path.extname(name).toLowerCase()];
  if (!mime) return null;
  try {
    const buf = await fsp.readFile(path.join(dir, subdir, name));
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const importLogo = (dir, srcPath) => importImage(dir, srcPath, { subdir: 'logos', prefix: 'logo', what: 'Логотип' });
const logoDataUrl = (dir, file) => imageDataUrl(dir, 'logos', file);
const importBackground = (dir, srcPath) => importImage(dir, srcPath, { subdir: 'backgrounds', prefix: 'bg', what: 'Фон' });
const backgroundDataUrl = (dir, file) => imageDataUrl(dir, 'backgrounds', file);

module.exports = { defaultSettings, loadSettings, saveSettings, importLogo, logoDataUrl, importBackground, backgroundDataUrl, SETTINGS_VERSION };
