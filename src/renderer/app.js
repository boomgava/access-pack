'use strict';
/* global h, icon, plural, shortPath, renderSettingsView, APValidate, APLogin */

// window.api из preload — глобальная неизменяемая переменная; объявлять её заново нельзя (SyntaxError)
/* global api */
const uid = () => crypto.randomUUID();
const root = document.getElementById('app');

const state = {
  settings: null,
  view: 'edit', // edit | result | settings | history
  employees: [],
  library: { groups: [], error: null },
  checked: new Set(), // отмеченные пути из библиотеки
  collapsed: new Set(), // свёрнутые разделы библиотеки (до закрытия окна)
  extras: [], // разовые файлы: { path, name, checked }
  profileId: '',
  encryption: 'zipcrypto',
  outDir: '',
  showErrors: false,
  preflightErrors: [],
  building: false,
  progress: null,
  result: null,
  notice: null,
  history: { entries: [], query: '', expanded: new Set(), confirmClear: false },
  update: null, // { latest, url, notes }
  sendAfterBuild: false,
  sending: false,
  mailStatus: {}, // по ФИО: { state: 'ok' | 'error' | 'sending', text }
};

// ---------- данные ----------

function systemById(id) {
  return state.settings.systems.find((s) => s.id === id);
}

function newAccount(emp) {
  const used = new Set(emp.accounts.map((a) => a.systemId));
  const sys = state.settings.systems.find((s) => !used.has(s.id)) || state.settings.systems[0];
  return { id: uid(), systemId: sys ? sys.id : '', login: '', password: '', reveal: false };
}

function newEmployee() {
  const emp = { id: uid(), fio: '', email: '', accounts: [] };
  emp.accounts.push(newAccount(emp));
  return emp;
}

function demoEmployees() {
  const e1 = { id: uid(), fio: 'Иванов Иван Иванович', accounts: [] };
  e1.accounts.push({ id: uid(), systemId: 'domain', login: 'ivanov.i', password: 'Start-2026!', reveal: false });
  e1.accounts.push({ id: uid(), systemId: 'yandex360', login: 'i.ivanov@example.com', password: 'Ya-Start-7', reveal: true });
  const e2 = { id: uid(), fio: 'Петрова Анна Сергеевна', accounts: [] };
  e2.accounts.push({ id: uid(), systemId: 'domain', login: 'petrova.a', password: 'Start-2026!', reveal: false });
  return [e1, e2];
}

function hasInput() {
  return state.employees.some((e) => e.fio.trim() || e.accounts.some((a) => a.login || a.password));
}

function validationErrors() {
  return APValidate.validateBatch(state.employees, state.settings.systems, { requireEmail: state.sendAfterBuild });
}

function libraryItems() {
  return state.library.groups.flatMap((g) => g.items);
}

function selectedAttachments() {
  return [
    ...libraryItems().filter((i) => state.checked.has(i.path)).map((i) => i.path),
    ...state.extras.filter((x) => x.checked).map((x) => x.path),
  ];
}

async function reloadLibrary() {
  state.library = await api.listLibrary(state.settings.libraryPath);
  const present = new Set(libraryItems().map((i) => i.path));
  for (const p of [...state.checked]) if (!present.has(p)) state.checked.delete(p);
}

function cleanError(err) {
  return String(err && err.message ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------- реакция на ввод без перерисовки (чтобы не терять фокус) ----------

function onEdit() {
  api.setDirty(hasInput());
  refreshErrors();
}

function refreshErrors() {
  const errs = state.showErrors ? validationErrors() : [];
  for (const el of root.querySelectorAll('[data-field]')) {
    const { emp, acc, field } = el.dataset;
    const bad = errs.some(
      (e) => e.employeeId === emp && (acc ? e.accountId === acc : !e.accountId) && e.field === field,
    );
    el.classList.toggle('invalid', bad);
  }
  const status = document.getElementById('build-status');
  if (status) {
    const messages = [];
    if (errs.length) messages.push(`Заполните отмеченные поля: ${errs.length}`);
    for (const e of state.preflightErrors) messages.push(e.message);
    status.replaceChildren(...messages.map((m) => h('div', {}, m)));
  }
}

// ---------- действия ----------

function addEmployee() {
  state.employees.push(newEmployee());
  render();
  const inputs = root.querySelectorAll('.fio');
  inputs[inputs.length - 1]?.focus();
}

function removeEmployee(emp) {
  const filled = emp.fio.trim() || emp.accounts.some((a) => a.login || a.password);
  if (filled && !confirm(`Удалить «${emp.fio.trim() || 'сотрудника'}» из пачки?`)) return;
  state.employees = state.employees.filter((e) => e !== emp);
  onEdit();
  render();
}

async function pickLibrary() {
  const p = await api.pickFolder(state.settings.libraryPath);
  if (!p) return;
  state.settings.libraryPath = p;
  await api.saveSettings(state.settings);
  state.checked.clear();
  await reloadLibrary();
  render();
}

async function pickOutDir() {
  const p = await api.pickFolder(state.outDir);
  if (!p) return;
  state.outDir = p;
  state.settings.outputPath = p;
  await api.saveSettings(state.settings);
  state.preflightErrors = state.preflightErrors.filter((e) => e.field !== 'outDir');
  render();
}

function addExtraPaths(paths) {
  const known = new Set(state.extras.map((x) => x.path));
  for (const p of paths) {
    if (!p || known.has(p)) continue;
    state.extras.push({ path: p, name: p.split(/[\\/]/).pop(), checked: true });
  }
  refreshAttachments();
}

async function addExtras() {
  addExtraPaths(await api.pickFiles());
}

function onDropExtras(ev) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('over');
  addExtraPaths(Array.from(ev.dataTransfer.files, (f) => api.pathForFile(f)));
}

async function startBuild() {
  state.showErrors = true;
  state.preflightErrors = [];
  if (validationErrors().length) {
    refreshErrors();
    return;
  }
  state.building = true;
  state.progress = { done: 0, total: state.employees.length };
  render();
  try {
    const res = await api.build({
      employees: state.employees.map((e) => ({
        id: e.id,
        fio: e.fio,
        email: (e.email || '').trim(),
        accounts: e.accounts.map((a) => ({ id: a.id, systemId: a.systemId, login: a.login, password: a.password })),
      })),
      attachments: selectedAttachments(),
      profileId: state.profileId,
      encryption: state.encryption,
      outDir: state.outDir,
    });
    if (res.ok) {
      const byFio = new Map(state.employees.map((e) => [e.fio.trim(), (e.email || '').trim()]));
      for (const row of res.results) row.email = byFio.get(row.fio) || '';
      state.result = res;
      state.mailStatus = {};
      state.view = 'result';
      api.setDirty(false);
    } else {
      state.preflightErrors = res.errors.filter((e) => e.field === 'attachment' || e.field === 'outDir');
    }
  } catch (err) {
    state.notice = { text: `Сборка не удалась: ${cleanError(err)}`, error: true };
  } finally {
    state.building = false;
    state.progress = null;
    render();
  }
}

function newBatch() {
  state.employees = [newEmployee()];
  state.extras = [];
  state.result = null;
  state.showErrors = false;
  state.preflightErrors = [];
  state.view = 'edit';
  api.setDirty(false);
  render();
}

async function copyText(text, button) {
  await api.copy(text);
  if (!button) return;
  const before = Array.from(button.childNodes);
  button.replaceChildren(icon('check'), button.classList.contains('icon-btn') ? '' : 'Скопировано');
  setTimeout(() => button.replaceChildren(...before), 1200);
}

async function saveSettingsFromView(next) {
  await api.saveSettings(next);
  const libraryChanged = next.libraryPath !== state.settings.libraryPath;
  state.settings = next;
  if (!next.profiles.some((p) => p.id === state.profileId)) state.profileId = next.defaultProfileId;
  if (libraryChanged) state.checked.clear();
  state.outDir = next.outputPath;
  await applyAppearance();
  await reloadLibrary();
  state.view = 'edit';
  render();
}

// ---------- оформление ----------

// Тема — набор переменных CSS, картинки подставляются через CSSOM:
// в CSP нет 'unsafe-inline', поэтому style-атрибуты в разметке не используем.
async function applyAppearance() {
  const s = state.settings || {};
  const html = document.documentElement;
  html.dataset.theme = s.theme || 'system';

  const bg = s.backgroundFile ? await api.backgroundPreview(s.backgroundFile) : null;
  if (bg) {
    html.dataset.bg = 'on';
    document.body.style.setProperty('--bg-image', `url("${bg}")`);
    html.style.setProperty('--bg-dim', String((Number(s.backgroundDim) || 0) / 100));
  } else {
    delete html.dataset.bg;
    document.body.style.removeProperty('--bg-image');
  }

  document.querySelector('.mascot')?.remove();
  delete html.dataset.mascot;
  const url = s.mascot ? await api.mascotImage(s.mascot) : null;
  if (!url) return;
  html.dataset.mascot = 'on';
  const img = h('img', { class: 'mascot', alt: '' });
  img.src = url;
  html.style.setProperty('--mascot-opacity', String((Number(s.mascotOpacity) || 85) / 100));
  document.body.append(img);
}

// ---------- экраны ----------

function topbar(...right) {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, icon('lock'), 'Пакет доступов'),
    h('div', { class: 'spacer' }),
    ...right);
}

// Уведомление о новой версии: программа не обновляет себя сама, а ведёт на страницу релиза
function updateBar() {
  if (!state.update) return null;
  const u = state.update;
  return h('div', { class: 'notice update' },
    icon('down'),
    h('span', {}, `Вышла версия ${u.latest}, у вас ${u.current}${u.file ? ` — ${u.file.name}` : ''}`),
    h('button', { class: 'link', onclick: () => api.openLink(u.url) }, 'Открыть страницу загрузки'),
    h('button', { class: 'link', onclick: () => { state.update = null; render(); } }, 'Скрыть'));
}

function noticeBar() {
  if (!state.notice) return null;
  return h('div', { class: `notice${state.notice.error ? ' error' : ''}` },
    h('span', {}, state.notice.text),
    h('button', { class: 'link', onclick: () => { state.notice = null; render(); } }, 'Скрыть'));
}

function accountRow(emp, acc) {
  const at = (field) => ({ emp: emp.id, acc: acc.id, field });
  const preview = h('div', { class: 'login-preview' });
  const updatePreview = () => {
    const sys = systemById(acc.systemId);
    const full = acc.login.trim() && sys ? APLogin.fullLogin(acc.login, sys) : '';
    preview.textContent = full && full !== acc.login.trim() ? `→ ${full}` : '';
  };
  const pass = h('input', {
    class: 'field mono',
    type: acc.reveal ? 'text' : 'password',
    placeholder: 'Пароль',
    value: acc.password,
    autocomplete: 'off',
    spellcheck: 'false',
    dataset: at('password'),
    oninput: (ev) => { acc.password = ev.target.value; onEdit(); },
  });
  const eye = h('button', { class: 'icon-btn', title: 'Показать или скрыть пароль', tabindex: '-1' }, icon(acc.reveal ? 'eyeOff' : 'eye'));
  eye.addEventListener('click', () => {
    acc.reveal = !acc.reveal;
    pass.type = acc.reveal ? 'text' : 'password';
    eye.replaceChildren(icon(acc.reveal ? 'eyeOff' : 'eye'));
  });
  const known = Boolean(systemById(acc.systemId));
  const row = h('div', { class: 'account' },
    h('select', {
      class: 'field',
      title: known ? systemById(acc.systemId).name : '',
      dataset: at('system'),
      onchange: (ev) => {
        acc.systemId = ev.target.value;
        ev.target.title = systemById(acc.systemId).name;
        updatePreview();
        onEdit();
      },
    },
    !known && h('option', { value: '', selected: true, disabled: true }, 'Выберите систему'),
    state.settings.systems.map((s) => h('option', { value: s.id, selected: s.id === acc.systemId }, s.name))),
    h('div', {},
      h('input', {
        class: 'field mono',
        placeholder: 'Логин',
        value: acc.login,
        autocomplete: 'off',
        spellcheck: 'false',
        dataset: at('login'),
        oninput: (ev) => { acc.login = ev.target.value; updatePreview(); onEdit(); },
      }),
      preview),
    h('div', { class: 'pass-wrap' }, pass, eye),
    h('button', {
      class: 'icon-btn danger',
      title: 'Удалить учётку',
      onclick: () => { emp.accounts = emp.accounts.filter((a) => a !== acc); onEdit(); render(); },
    }, icon('x')));
  updatePreview();
  return row;
}

function employeeCard(emp) {
  return h('article', { class: 'card' },
    h('div', { class: 'card-top' },
      h('input', {
        class: 'field fio',
        placeholder: 'Фамилия Имя Отчество',
        value: emp.fio,
        dataset: { emp: emp.id, field: 'fio' },
        oninput: (ev) => { emp.fio = ev.target.value; onEdit(); },
      }),
      h('button', { class: 'icon-btn danger', title: 'Удалить сотрудника', onclick: () => removeEmployee(emp) }, icon('x'))),
    state.sendAfterBuild
      ? h('div', { class: 'card-mail' },
        icon('mail'),
        h('input', {
          class: 'field',
          type: 'email',
          placeholder: 'Почта для отправки архива',
          value: emp.email || '',
          autocomplete: 'off',
          spellcheck: 'false',
          dataset: { emp: emp.id, field: 'email' },
          oninput: (ev) => { emp.email = ev.target.value; onEdit(); },
        }))
      : null,
    h('div', { class: 'accounts' }, emp.accounts.map((acc) => accountRow(emp, acc))),
    h('button', {
      class: 'btn small ghost',
      dataset: { emp: emp.id, field: 'accounts' },
      onclick: () => { emp.accounts.push(newAccount(emp)); onEdit(); render(); },
    }, icon('plus'), 'Учётка'));
}

function checkItem({ name, kind, checked, missing, onToggle, onRemove }) {
  return h('li', {},
    h('label', { class: `check-item${missing ? ' missing' : ''}`, title: name },
      h('input', { type: 'checkbox', checked, onchange: (ev) => onToggle(ev.target.checked) }),
      icon(kind === 'dir' ? 'folder' : 'file'),
      h('span', { class: 'name' }, name),
      onRemove && h('button', {
        class: 'icon-btn danger',
        title: 'Убрать из списка',
        onclick: (ev) => { ev.preventDefault(); onRemove(); },
      }, icon('x'))));
}

// Раздел библиотеки: заголовок со стрелкой, галочкой на весь раздел и счётчиком
function libraryGroup(group, missing, onToggle) {
  const collapsed = state.collapsed.has(group.path);
  const checkedCount = group.items.filter((i) => state.checked.has(i.path)).length;
  const all = checkedCount === group.items.length;
  const box = h('input', {
    type: 'checkbox',
    checked: all,
    onchange: (ev) => {
      for (const i of group.items) {
        if (ev.target.checked) state.checked.add(i.path);
        else state.checked.delete(i.path);
      }
      onToggle();
    },
  });
  box.indeterminate = checkedCount > 0 && !all;
  return h('section', { class: 'group' },
    h('div', { class: 'group-head' },
      h('button', {
        class: 'icon-btn chevron',
        title: collapsed ? 'Развернуть' : 'Свернуть',
        onclick: () => {
          if (collapsed) state.collapsed.delete(group.path);
          else state.collapsed.add(group.path);
          refreshAttachments();
        },
      }, icon(collapsed ? 'chevronRight' : 'chevronDown')),
      h('label', { class: 'group-title', title: group.name }, box, h('span', { class: 'name' }, group.name)),
      h('span', { class: 'hint' }, `${checkedCount} из ${group.items.length}`)),
    !collapsed && h('ul', { class: 'checklist' }, group.items.map((it) => checkItem({
      name: it.name,
      kind: it.kind,
      checked: state.checked.has(it.path),
      missing: missing.has(it.path),
      onToggle: (v) => {
        if (v) state.checked.add(it.path);
        else state.checked.delete(it.path);
        onToggle();
      },
    }))));
}

// Перерисовать только панель вложений: счётчики разделов меняются при каждой галочке,
// а полный render() сбрасывал бы фокус в полях сотрудников
function refreshAttachments() {
  document.getElementById('attachments')?.replaceWith(attachmentsPanel());
}

function attachmentsPanel() {
  const missing = new Set(state.preflightErrors.filter((e) => e.field === 'attachment').map((e) => e.path));
  const onToggle = () => {
    state.preflightErrors = state.preflightErrors.filter((e) => e.field !== 'attachment');
    refreshAttachments();
    refreshErrors();
  };
  const lib = state.library;
  let libraryList;
  if (!state.settings.libraryPath) {
    libraryList = h('div', { class: 'empty' }, 'Выберите папку, где лежат RDP, инструкции и ПО: подпапки станут разделами');
  } else if (lib.error) libraryList = h('div', { class: 'empty' }, lib.error);
  else if (!lib.groups.length) libraryList = h('div', { class: 'empty' }, 'В папке нет файлов');
  else {
    libraryList = h('div', { class: 'groups' }, lib.groups.map((g) => libraryGroup(g, missing, onToggle)));
  }
  return h('section', { class: 'panel', id: 'attachments' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Вложения'), h('span', { class: 'hint' }, 'общие для всех')),
    h('div', { class: 'lib-path' },
      h('div', { class: 'path', title: state.settings.libraryPath || '' },
        state.settings.libraryPath ? shortPath(state.settings.libraryPath) : 'Библиотека не выбрана'),
      h('button', { class: 'icon-btn', title: 'Обновить список', onclick: async () => { await reloadLibrary(); refreshAttachments(); } }, icon('refresh')),
      h('button', { class: 'btn small', onclick: pickLibrary }, 'Выбрать…')),
    libraryList,
    h('div', { class: 'subhead' }, 'Разовые файлы'),
    h('div', {
      class: 'dropzone',
      ondragover: (ev) => { ev.preventDefault(); ev.currentTarget.classList.add('over'); },
      ondragleave: (ev) => ev.currentTarget.classList.remove('over'),
      ondrop: onDropExtras,
    },
    state.extras.length
      ? h('ul', { class: 'checklist' }, state.extras.map((x) => checkItem({
        name: x.name,
        kind: 'file',
        checked: x.checked,
        missing: missing.has(x.path),
        onToggle: (v) => { x.checked = v; onToggle(); },
        onRemove: () => { state.extras = state.extras.filter((y) => y !== x); refreshAttachments(); },
      })))
      : h('div', { class: 'drop-hint' }, 'Перетащите файлы сюда'),
    h('button', { class: 'btn small ghost', onclick: addExtras }, icon('plus'), 'Добавить файл')));
}

function bottomBar() {
  const n = state.employees.length;
  const outBad = state.preflightErrors.some((e) => e.field === 'outDir');
  return h('footer', { class: 'bottombar' },
    h('label', { class: 'opt' }, h('span', {}, 'Оформление'),
      h('select', { class: 'field', onchange: (ev) => { state.profileId = ev.target.value; } },
        state.settings.profiles.map((p) => h('option', { value: p.id, selected: p.id === state.profileId }, p.name)))),
    h('label', { class: 'opt' }, h('span', {}, 'Шифрование'),
      h('select', { class: 'field', onchange: (ev) => { state.encryption = ev.target.value; } },
        h('option', { value: 'zipcrypto', selected: state.encryption === 'zipcrypto' }, 'ZipCrypto — откроет Проводник'),
        h('option', { value: 'aes256', selected: state.encryption === 'aes256' }, 'AES-256 — нужен 7-Zip'))),
    h('div', { class: 'opt' }, h('span', {}, 'Куда'),
      h('div', { class: `path${outBad ? ' invalid' : ''}`, title: state.outDir }, shortPath(state.outDir) || 'не выбрано'),
      h('button', { class: 'btn small', onclick: pickOutDir }, 'Изменить…')),
    h('label', { class: 'opt check-inline', title: 'Появится поле почты у каждого сотрудника' },
      h('input', {
        type: 'checkbox',
        checked: state.sendAfterBuild,
        onchange: (ev) => {
          state.sendAfterBuild = ev.target.checked;
          state.settings.mail = { ...(state.settings.mail || {}), sendAfterBuild: state.sendAfterBuild };
          api.saveSettings(state.settings);
          render();
        },
      }),
      h('span', {}, 'Отправить письма')),
    h('div', { class: 'spacer' }),
    h('div', { class: 'build-status', id: 'build-status' }),
    h('button', { class: 'btn', onclick: startMemos, disabled: n === 0 || state.building },
      icon('file'), 'Только памятка'),
    h('button', { class: 'btn primary', onclick: startBuild, disabled: n === 0 || state.building },
      icon('lock'), `Собрать ${n} ${plural(n, 'архив', 'архива', 'архивов')}`));
}

function viewEdit() {
  return h('div', { class: 'layout' },
    topbar(
      h('button', { class: 'btn ghost', onclick: openHistory }, icon('clock'), 'История'),
      h('button', { class: 'btn ghost', onclick: () => { state.view = 'settings'; render(); } }, icon('settings'), 'Настройки')),
    updateBar(),
    noticeBar(),
    h('main', { class: 'columns' },
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', {}, 'Сотрудники'), h('span', { class: 'count' }, String(state.employees.length))),
        h('div', { class: 'cards' }, state.employees.map(employeeCard)),
        h('button', { class: 'btn dashed', onclick: addEmployee }, icon('plus'), 'Сотрудник')),
      attachmentsPanel()),
    bottomBar());
}

// Только памятки: PDF без архивов, паролей и вложений
async function startMemos() {
  state.showErrors = true;
  state.preflightErrors = [];
  if (APValidate.validateBatch(state.employees, state.settings.systems).length) {
    refreshErrors();
    return;
  }
  state.building = true;
  state.progress = { done: 0, total: state.employees.length };
  render();
  try {
    const res = await api.buildMemos({
      employees: state.employees.map((e) => ({
        id: e.id,
        fio: e.fio,
        email: (e.email || '').trim(),
        accounts: e.accounts.map((a) => ({ id: a.id, systemId: a.systemId, login: a.login, password: a.password })),
      })),
      profileId: state.profileId,
      outDir: state.outDir,
    });
    if (res.ok) {
      state.result = res;
      state.view = 'result';
    } else {
      state.preflightErrors = res.errors.filter((e) => e.field === 'outDir');
    }
  } catch (err) {
    state.notice = { text: `Памятки не собрались: ${cleanError(err)}`, error: true };
  } finally {
    state.building = false;
    state.progress = null;
    render();
  }
}

// ---------- отправка писем ----------

function mailReady() {
  const m = (state.settings && state.settings.mail) || {};
  return Boolean(m.host && (m.from || m.user));
}

async function sendOne(row) {
  state.mailStatus[row.fio] = { state: 'sending', text: 'отправляю…' };
  render();
  const res = await api.sendMail({
    fio: row.fio,
    to: row.email,
    archive: row.archive,
    folder: state.result.folder,
  });
  state.mailStatus[row.fio] = res.ok
    ? { state: 'ok', text: `отправлено на ${row.email}` }
    : { state: 'error', text: res.error };
  render();
}

async function sendAll() {
  if (state.sending) return;
  state.sending = true;
  render();
  try {
    for (const row of state.result.results) {
      if (row.error || !row.email) continue;
      if (state.mailStatus[row.fio]?.state === 'ok') continue;
      await sendOne(row);
    }
  } finally {
    state.sending = false;
    render();
  }
}

function mailStatusCell(row) {
  const st = state.mailStatus[row.fio];
  if (!st) return h('td', { class: 'mail-status' }, '');
  return h('td', { class: `mail-status ${st.state}` }, st.state === 'ok' ? icon('check') : null, h('span', {}, st.text));
}

function viewResult() {
  const r = state.result;
  const ok = r.results.filter((x) => !x.error);
  const failed = r.results.length - ok.length;
  const mail = (state.settings && state.settings.mail) || {};
  if (r.memos) {
    const title = `Готово: ${ok.length} ${plural(ok.length, 'памятка', 'памятки', 'памяток')}${failed ? `, не собрано: ${failed}` : ''}`;
    return h('div', { class: 'layout' },
      topbar(),
      h('main', { class: 'result' },
        h('div', { class: 'result-head' },
          h('div', { class: `badge ${failed ? 'warn' : 'ok'}` }, icon(failed ? 'x' : 'check')),
          h('div', {}, h('h2', {}, title), h('div', { class: 'path', title: r.folder }, r.folder))),
        h('table', { class: 'result-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Сотрудник'), h('th', {}, 'Файл'))),
          h('tbody', {}, r.results.map((x) => (x.error
            ? h('tr', { class: 'failed' }, h('td', {}, x.fio), h('td', {}, `Не собрана: ${x.error}`))
            : h('tr', {}, h('td', {}, x.fio), h('td', { class: 'mono' }, x.file)))))),
        h('div', { class: 'result-actions' },
          h('button', { class: 'btn primary', onclick: () => api.openFolder(r.folder) }, icon('folder'), 'Открыть папку'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn ghost', onclick: () => { state.view = 'edit'; render(); } }, 'Назад к пачке'),
          h('button', { class: 'btn ghost', onclick: newBatch }, 'Новая пачка')),
        h('p', { class: 'hint' }, 'Это только памятки с доступами, без архивов и паролей. Отправлять их почтой без шифрования не стоит.')));
  }
  const title = `Готово: ${ok.length} ${plural(ok.length, 'архив', 'архива', 'архивов')}${failed ? `, не собрано: ${failed}` : ''}`;
  const allText = ok.map((x) => `${x.fio}\t${x.archive}\t${x.password}`).join('\n');
  const waiting = ok.filter((x) => x.email && state.mailStatus[x.fio]?.state !== 'ok').length;
  const showMail = state.sendAfterBuild || ok.some((x) => x.email);
  return h('div', { class: 'layout' },
    topbar(),
    h('main', { class: 'result' },
      h('div', { class: 'result-head' },
        h('div', { class: `badge ${failed ? 'warn' : 'ok'}` }, icon(failed ? 'x' : 'check')),
        h('div', {}, h('h2', {}, title), h('div', { class: 'path', title: r.folder }, r.folder))),
      h('table', { class: 'result-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Сотрудник'),
          h('th', {}, 'Архив'),
          h('th', {}, 'Пароль архива'),
          showMail ? h('th', {}, 'Кому отправить') : null,
          showMail ? h('th', {}, 'Письмо') : null,
          h('th', {}))),
        h('tbody', {}, r.results.map((x) => (x.error
          ? h('tr', { class: 'failed' }, h('td', {}, x.fio), h('td', { colspan: showMail ? '5' : '3' }, `Не собран: ${x.error}`))
          : h('tr', {},
            h('td', {}, x.fio),
            h('td', { class: 'mono' }, x.archive),
            h('td', { class: 'mono pw' }, x.password),
            showMail
              ? h('td', {}, h('input', {
                class: 'field mail-input',
                type: 'email',
                placeholder: 'почта получателя',
                value: x.email || '',
                spellcheck: 'false',
                oninput: (ev) => { x.email = ev.target.value.trim(); },
              }))
              : null,
            showMail ? mailStatusCell(x) : null,
            h('td', { class: 'act' },
              showMail
                ? h('button', {
                  class: 'icon-btn',
                  title: 'Отправить письмо этому сотруднику',
                  disabled: state.sending || !x.email,
                  onclick: () => sendOne(x),
                }, icon('send'))
                : null,
              h('button', {
                class: 'icon-btn',
                title: 'Скопировать пароль',
                onclick: (ev) => copyText(x.password, ev.currentTarget),
              }, icon('copy')))))))),
      h('div', { class: 'result-actions' },
        showMail
          ? h('button', {
            class: 'btn primary',
            disabled: state.sending || !waiting || !mailReady(),
            onclick: sendAll,
          }, icon('send'), state.sending ? 'Отправляю…' : `Отправить ${waiting} ${plural(waiting, 'письмо', 'письма', 'писем')}`)
          : null,
        h('button', { class: `btn ${showMail ? '' : 'primary'}`, onclick: () => api.openFolder(r.folder) }, icon('folder'), 'Открыть папку'),
        h('button', { class: 'btn', onclick: (ev) => copyText(allText, ev.currentTarget) }, icon('copy'), 'Скопировать всё'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn ghost', onclick: openHistory }, icon('clock'), 'История'),
        h('button', { class: 'btn ghost', onclick: () => { state.view = 'edit'; render(); } }, 'Назад к пачке'),
        h('button', { class: 'btn ghost', onclick: newBatch }, 'Новая пачка')),
      showMail && !mailReady()
        ? h('p', { class: 'hint' }, 'Почта не настроена: Настройки → «Почта» — сервер, логин, пароль и адрес отправителя.')
        : null,
      showMail && mailReady() && mail.cc
        ? h('p', { class: 'hint' }, `Копия каждого письма уйдёт на ${mail.cc}. Пароль от архива в письмо не попадает.`)
        : null,
      h('p', { class: 'hint' }, 'Пароли также сохранены в «Пароли.txt» в этой папке. Не отправляйте его вместе с архивами.')));
}

// ---------- история выданных архивов ----------

async function openHistory() {
  state.view = 'history';
  state.history.confirmClear = false;
  render();
  const { entries, warning } = await api.listHistory();
  state.history.entries = entries;
  if (warning) state.notice = { text: warning, error: true };
  render();
}

function historyMatches(e, query) {
  if (!query) return true;
  const haystack = [e.fio, e.archive, ...(e.accounts || []).flatMap((a) => [a.system, a.login])].join(' ').toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function formatMoment(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function deleteHistoryEntry(id) {
  const { entries } = await api.deleteHistory(id);
  state.history.entries = entries;
  render();
}

async function clearHistoryAll() {
  const { entries } = await api.clearHistory();
  state.history.entries = entries;
  state.history.confirmClear = false;
  render();
}

function historyDetails(e) {
  const accounts = (e.accounts || []).map((a) => h('div', { class: 'detail-row' },
    h('span', { class: 'detail-label' }, a.system),
    h('span', { class: 'mono' }, a.login)));
  const attachments = (e.attachments || []).length
    ? h('div', { class: 'detail-row' }, h('span', { class: 'detail-label' }, 'Вложения'), h('span', {}, e.attachments.join(', ')))
    : null;
  return h('tr', { class: 'details' }, h('td', { colspan: '5' },
    h('div', { class: 'history-details' },
      accounts.length ? h('div', { class: 'detail-title' }, 'Учётки в архиве') : h('div', { class: 'detail-title' }, 'Состав не записан'),
      ...accounts,
      attachments,
      e.folder ? h('div', { class: 'detail-row' }, h('span', { class: 'detail-label' }, 'Папка'), h('span', { class: 'path', title: e.folder }, shortPath(e.folder))) : null,
      e.encryption ? h('div', { class: 'detail-row' }, h('span', { class: 'detail-label' }, 'Шифрование'), h('span', {}, e.encryption === 'aes256' ? 'AES-256' : 'ZipCrypto')) : null)));
}

function historyRow(e) {
  const open = state.history.expanded.has(e.id);
  const toggle = () => {
    if (open) state.history.expanded.delete(e.id);
    else state.history.expanded.add(e.id);
    render();
  };
  const row = h('tr', {},
    h('td', { class: 'when' }, formatMoment(e.at)),
    h('td', {},
      h('button', { class: 'link row-toggle', onclick: toggle }, icon(open ? 'chevronDown' : 'chevronRight'), e.fio || '—')),
    h('td', { class: 'mono' }, e.archive || '—'),
    h('td', { class: 'mono pw' }, e.password || '—'),
    h('td', { class: 'act' },
      e.password ? h('button', {
        class: 'icon-btn',
        title: 'Скопировать пароль',
        onclick: (ev) => copyText(e.password, ev.currentTarget),
      }, icon('copy')) : null,
      e.folder ? h('button', { class: 'icon-btn', title: 'Открыть папку', onclick: () => api.openFolder(e.folder) }, icon('folder')) : null,
      h('button', { class: 'icon-btn danger', title: 'Удалить запись', onclick: () => deleteHistoryEntry(e.id) }, icon('x'))));
  return open ? [row, historyDetails(e)] : [row];
}

function viewHistory() {
  const all = state.history.entries;
  const rows = all.filter((e) => historyMatches(e, state.history.query));
  const days = (state.settings && state.settings.historyDays) || 90;
  const table = rows.length
    ? h('table', { class: 'result-table history-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Когда'), h('th', {}, 'Сотрудник'), h('th', {}, 'Архив'), h('th', {}, 'Пароль архива'), h('th', {}))),
      h('tbody', {}, rows.flatMap(historyRow)))
    : h('p', { class: 'empty' }, all.length ? 'Ничего не нашлось по этому запросу.' : 'История пуста — она заполняется при сборке архивов.');
  return h('div', { class: 'layout' },
    topbar(h('button', { class: 'btn ghost', onclick: () => { state.view = 'edit'; render(); } }, 'Назад к пачке')),
    noticeBar(),
    h('main', { class: 'result' },
      h('div', { class: 'history-head' },
        h('h2', {}, `История: ${all.length} ${plural(all.length, 'архив', 'архива', 'архивов')}`),
        h('div', { class: 'spacer' }),
        h('input', {
          class: 'field search',
          type: 'search',
          placeholder: 'Поиск по сотруднику, архиву, логину',
          value: state.history.query,
          oninput: (ev) => { state.history.query = ev.target.value; render(); },
        })),
      table,
      h('div', { class: 'result-actions' },
        h('div', { class: 'spacer' }),
        all.length
          ? h('button', {
            class: `btn ${state.history.confirmClear ? 'danger' : 'ghost'}`,
            onclick: () => {
              if (state.history.confirmClear) clearHistoryAll();
              else { state.history.confirmClear = true; render(); }
            },
          }, state.history.confirmClear ? 'Точно очистить всё?' : 'Очистить историю')
          : null),
      h('p', { class: 'hint' }, `Записи старше ${days} ${plural(days, 'дня', 'дней', 'дней')} удаляются сами. Пароли хранятся в открытом виде в папке программы — как в «Пароли.txt».`)));
}

function viewProgress() {
  const p = state.progress || { done: 0, total: 0 };
  const fill = h('div', { class: 'bar-fill', id: 'bar-fill' });
  fill.style.width = `${p.total ? Math.round((p.done / p.total) * 100) : 0}%`;
  return h('div', { class: 'overlay' },
    h('div', { class: 'progress-box' },
      h('div', { id: 'progress-text' }, `Собираю архивы… ${p.done} из ${p.total}`),
      h('div', { class: 'bar' }, fill)));
}

function render() {
  let view;
  if (state.view === 'settings') {
    view = renderSettingsView({
      settings: state.settings,
      api,
      onSave: saveSettingsFromView,
      onCancel: () => { state.view = 'edit'; render(); },
    });
  } else if (state.view === 'history') {
    view = viewHistory();
  } else if (state.view === 'result') {
    view = viewResult();
  } else {
    view = viewEdit();
  }
  root.replaceChildren(view);
  if (state.building) root.append(viewProgress());
  if (state.view === 'edit') refreshErrors();
}

api.onBuildProgress((p) => {
  state.progress = p;
  const text = document.getElementById('progress-text');
  const fill = document.getElementById('bar-fill');
  if (text) text.textContent = `Собираю архивы… ${p.done} из ${p.total}`;
  if (fill) fill.style.width = `${Math.round((p.done / p.total) * 100)}%`;
});

// Файл, брошенный мимо зоны, не должен открываться в окне
document.addEventListener('dragover', (ev) => ev.preventDefault());
document.addEventListener('drop', (ev) => ev.preventDefault());

async function init() {
  const { settings, warning } = await api.loadSettings();
  state.settings = settings;
  if (warning) state.notice = { text: warning, error: true };
  state.profileId = settings.profiles.some((p) => p.id === settings.defaultProfileId)
    ? settings.defaultProfileId
    : settings.profiles[0].id;
  state.encryption = settings.encryption || 'zipcrypto';
  state.sendAfterBuild = Boolean(settings.mail && settings.mail.sendAfterBuild);
  state.outDir = api.demoOut || settings.outputPath || '';
  state.employees = api.demo ? demoEmployees() : [newEmployee()];
  if (api.demo === 'settings') state.view = 'settings';
  await applyAppearance();
  await reloadLibrary();
  render();
  api.setDirty(hasInput());
  if (settings.checkUpdates !== false) {
    api.checkUpdate().then((res) => {
      if (res.ok && res.newer) {
        state.update = res;
        render();
      }
    });
  }
  if (api.demo === 'build') startBuild();
}

init();
