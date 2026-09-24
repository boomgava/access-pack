'use strict';
/* global h, icon, shortPath */

function renderSettingsView({ settings, api, onSave, onCancel }) {
  const draft = structuredClone(settings);
  const root = h('div', { class: 'layout' });
  let error = '';
  let mascotList = [];
  let mailPassword = null; // null — не меняли; '' — стереть; строка — новый пароль
  let passwordSaved = false;
  let mailCheck = '';
  let updateCheck = '';
  let transferNote = '';
  let pending = null; // разобранный файл настроек: ждём выбора режима
  let importMode = 'shared';

  const labeled = (label, control) => h('label', { class: 'lbl' }, label, control);
  // Для блоков с кнопками — не <label>: иначе клик по подписи «нажимает» первую кнопку
  const group = (label, content) => h('div', { class: 'lbl' }, label, content);
  const input = (obj, key, placeholder) =>
    h('input', { class: 'field', value: obj[key] || '', placeholder, oninput: (ev) => { obj[key] = ev.target.value; } });

  function move(list, i, delta) {
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    draw();
  }

  function systemCard(s, i) {
    return h('div', { class: 'card settings-card' },
      h('div', { class: 'grid2' },
        labeled('Название', input(s, 'name', 'Например, Яндекс 360')),
        labeled('Адрес входа', input(s, 'url', 'https://…')),
        labeled('Префикс домена', input(s, 'domainPrefix', 'например, company\\')),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: Boolean(s.rdp), onchange: (ev) => { s.rdp = ev.target.checked; } }),
          'Подставлять логин в .rdp')),
      labeled('Шаги инструкции — по одному в строке',
        h('textarea', { class: 'field', rows: '3', value: (s.steps || []).join('\n'), oninput: (ev) => { s.steps = ev.target.value.split('\n'); } })),
      h('div', { class: 'card-actions' },
        h('button', { class: 'icon-btn', title: 'Выше', onclick: () => move(draft.systems, i, -1) }, icon('up')),
        h('button', { class: 'icon-btn', title: 'Ниже', onclick: () => move(draft.systems, i, 1) }, icon('down')),
        h('button', { class: 'btn small ghost danger', onclick: () => { draft.systems.splice(i, 1); draw(); } }, 'Удалить')));
  }

  function logoRow(p) {
    const preview = p.logoFile ? h('img', { class: 'logo-preview', alt: '' }) : h('span', { class: 'hint' }, 'нет — в шапке будет название компании');
    if (p.logoFile) api.logoPreview(p.logoFile).then((url) => { if (url) preview.src = url; });
    return h('div', { class: 'logo-row' },
      preview,
      h('button', {
        class: 'btn small',
        onclick: async () => {
          const src = await api.pickImage();
          if (!src) return;
          try {
            p.logoFile = await api.importLogo(src);
            error = '';
          } catch (err) {
            error = String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
          }
          draw();
        },
      }, 'Выбрать логотип…'),
      p.logoFile && h('button', { class: 'btn small ghost danger', onclick: () => { p.logoFile = ''; draw(); } }, 'Убрать'));
  }

  function profileCard(p, i) {
    return h('div', { class: 'card settings-card' },
      h('div', { class: 'grid2' },
        labeled('Название профиля', input(p, 'name', 'Например, «Основной»')),
        labeled('Компания в шапке PDF', input(p, 'company', 'Например, «Компания»'))),
      group('Логотип (PNG, JPG или SVG)', logoRow(p)),
      labeled('Примечание в подвал PDF — о смене пароля',
        h('input', {
          class: 'field',
          value: p.note || '',
          placeholder: 'Пароль нужно сменить при первом входе',
          oninput: (ev) => { p.note = ev.target.value; },
        })),
      labeled('Контакты поддержки — в подвал PDF',
        h('textarea', { class: 'field', rows: '2', value: p.support || '', placeholder: 'Телефон, почта, Telegram', oninput: (ev) => { p.support = ev.target.value; } })),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn small ghost danger', onclick: () => { draft.profiles.splice(i, 1); draw(); } }, 'Удалить')));
  }

  function pathRow(label, key) {
    return group(label, h('div', { class: 'row' },
      h('div', { class: 'path', title: draft[key] || '' }, draft[key] ? shortPath(draft[key]) : 'не выбрано'),
      h('button', {
        class: 'btn small',
        onclick: async () => {
          const p = await api.pickFolder(draft[key]);
          if (p) { draft[key] = p; draw(); }
        },
      }, 'Выбрать…')));
  }

  function mascotRow() {
    const chosen = mascotList.find((m) => m.id === draft.mascot);
    const preview = chosen ? h('img', { class: 'mascot-preview', alt: '' }) : h('span', { class: 'hint' }, 'без картинки');
    if (chosen) api.mascotImage(chosen.id).then((url) => { if (url) preview.src = url; });
    return h('div', { class: 'logo-row' },
      preview,
      h('div', { class: 'grow' },
        h('select', {
          class: 'field',
          onchange: (ev) => { draft.mascot = ev.target.value; draw(); },
        },
        h('option', { value: '', selected: !draft.mascot }, 'Нет'),
        mascotList.map((m) => h('option', { value: m.id, selected: m.id === draft.mascot }, m.name))),
        chosen && h('span', { class: 'hint' }, `Автор: ${chosen.credit}`)));
  }

  function backgroundRow() {
    const preview = draft.backgroundFile ? h('img', { class: 'mascot-preview', alt: '' }) : h('span', { class: 'hint' }, 'без фона');
    if (draft.backgroundFile) api.backgroundPreview(draft.backgroundFile).then((url) => { if (url) preview.src = url; });
    return h('div', { class: 'logo-row' },
      preview,
      h('button', {
        class: 'btn small',
        onclick: async () => {
          const src = await api.pickImage();
          if (!src) return;
          try {
            draft.backgroundFile = await api.importBackground(src);
            error = '';
          } catch (err) {
            error = String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
          }
          draw();
        },
      }, 'Выбрать картинку…'),
      draft.backgroundFile && h('button', { class: 'btn small ghost danger', onclick: () => { draft.backgroundFile = ''; draw(); } }, 'Убрать'));
  }

  function slider(label, key, hint) {
    const value = h('span', { class: 'hint slider-value' }, `${draft[key]}%`);
    const input = h('input', {
      class: 'slider',
      type: 'range',
      min: '0',
      max: '100',
      step: '5',
      value: String(draft[key]),
      oninput: (ev) => { draft[key] = Number(ev.target.value); value.textContent = `${draft[key]}%`; },
    });
    return group(label, h('div', { class: 'row' }, input, value, hint && h('span', { class: 'hint' }, hint)));
  }

  function transferSection() {
    const summary = pending && pending.summary;
    return h('section', { class: 'section' },
      h('h2', {}, 'Перенос настроек'),
      h('span', { class: 'hint' }, 'Файл с настройками и логотипами — чтобы передать коллеге или перенести на другой компьютер. Пароль почты не экспортируется: он лежит в ключнице системы'),
      h('div', { class: 'card settings-card' },
        h('div', { class: 'row' },
          h('button', {
            class: 'btn small',
            onclick: async () => {
              const res = await api.exportSettings();
              if (res.canceled) return;
              transferNote = res.ok
                ? `Сохранено: ${res.filePath}${res.logos ? `, логотипов: ${res.logos}` : ''}`
                : `Не вышло: ${res.error}`;
              draw();
            },
          }, 'Экспортировать…'),
          h('button', {
            class: 'btn small',
            onclick: async () => {
              const res = await api.readImport();
              if (res.canceled) return;
              if (!res.ok) {
                transferNote = res.error;
                pending = null;
              } else {
                pending = res;
                transferNote = '';
              }
              draw();
            },
          }, 'Импортировать…'),
          transferNote ? h('span', { class: 'hint' }, transferNote) : null),
        pending
          ? h('div', { class: 'import-box' },
            h('div', { class: 'hint' },
              `В файле: систем ${summary.systems}, профилей ${summary.profiles}`
              + (summary.logos ? `, логотипов ${summary.logos}` : '')
              + (summary.mail ? ', настройки почты' : '')
              + (pending.exportedAt ? ` · выгружено ${pending.exportedAt.slice(0, 10)}` : '')),
            h('label', { class: 'check' },
              h('input', {
                type: 'radio',
                name: 'import-mode',
                checked: importMode === 'shared',
                onchange: () => { importMode = 'shared'; },
              }),
              'Только общее: системы, профили, шаблон письма и вид. Мои папки и мои адреса почты останутся'),
            h('label', { class: 'check' },
              h('input', {
                type: 'radio',
                name: 'import-mode',
                checked: importMode === 'all',
                onchange: () => { importMode = 'all'; },
              }),
              'Всё из файла, включая папки и адреса почты — для переноса на свой новый компьютер'),
            h('div', { class: 'row' },
              h('button', {
                class: 'btn small primary',
                onclick: async () => {
                  const res = await api.applyImport({ settings: pending.settings, files: pending.files, mode: importMode });
                  if (!res.ok) {
                    transferNote = `Не вышло: ${res.error}`;
                    draw();
                    return;
                  }
                  pending = null;
                  // настройки на диске уже заменены — показываем их и закрываем экран
                  onSave(res.settings);
                },
              }, 'Применить'),
              h('button', { class: 'btn small ghost', onclick: () => { pending = null; draw(); } }, 'Отменить')))
          : null));
  }

  function updatesSection() {
    return h('section', { class: 'section' },
      h('h2', {}, 'Обновления'),
      h('span', { class: 'hint' }, 'Программа смотрит релизы на GitHub и сообщает о новой версии. Сама себя не обновляет и не скачивает'),
      h('div', { class: 'card settings-card' },
        h('label', { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: draft.checkUpdates !== false,
            onchange: (ev) => { draft.checkUpdates = ev.target.checked; },
          }),
          'Проверять при запуске'),
        h('div', { class: 'row' },
          h('button', {
            class: 'btn small',
            onclick: async (ev) => {
              ev.currentTarget.disabled = true;
              updateCheck = 'проверяю…';
              draw();
              const res = await api.checkUpdate();
              if (!res.ok) updateCheck = `Не вышло: ${res.error}`;
              else if (res.newer) updateCheck = `Вышла версия ${res.latest}, у вас ${res.current}`;
              else updateCheck = `У вас последняя версия (${res.current})`;
              draw();
            },
          }, 'Проверить сейчас'),
          updateCheck ? h('span', { class: 'hint' }, updateCheck) : null)));
  }

  function appearanceSection() {
    return h('section', { class: 'section' },
      h('h2', {}, 'Внешний вид'),
      h('span', { class: 'hint' }, 'Тема окна программы; на PDF с доступами это не влияет'),
      h('div', { class: 'card settings-card' },
        labeled('Тема',
          h('select', { class: 'field', onchange: (ev) => { draft.theme = ev.target.value; } },
            h('option', { value: 'system', selected: draft.theme === 'system' }, 'Как в системе'),
            h('option', { value: 'light', selected: draft.theme === 'light' }, 'Светлая'),
            h('option', { value: 'dark', selected: draft.theme === 'dark' }, 'Тёмная'),
            h('option', { value: 'kawaii', selected: draft.theme === 'kawaii' }, 'Розовая'))),
        group('Картинка в углу окна', mascotRow()),
        draft.mascot && slider('Прозрачность картинки', 'mascotOpacity'),
        group('Своя картинка на фоне (PNG, JPG или SVG)', backgroundRow()),
        draft.backgroundFile && slider('Затемнение фона', 'backgroundDim', 'чем больше, тем лучше читается текст')));
  }

  function mailSection() {
    const mail = draft.mail || (draft.mail = {});
    const field = (label, key, placeholder, type) =>
      labeled(label, h('input', {
        class: 'field',
        type: type || 'text',
        value: mail[key] === undefined || mail[key] === null ? '' : String(mail[key]),
        placeholder,
        autocomplete: 'off',
        spellcheck: 'false',
        oninput: (ev) => { mail[key] = key === 'port' ? Number(ev.target.value) || 0 : ev.target.value; },
      }));
    return h('section', { class: 'section' },
      h('h2', {}, 'Почта'),
      h('span', { class: 'hint' }, 'Отправка архивов письмом: сервер, шаблон и копия. Пароль хранится в ключнице системы, не в настройках'),
      h('div', { class: 'card settings-card' },
        h('div', { class: 'grid2' },
          field('SMTP-сервер', 'host', 'например, mail.example.com'),
          field('Порт', 'port', '587', 'number'),
          labeled('Шифрование',
            h('select', { class: 'field', onchange: (ev) => { mail.security = ev.target.value; } },
              h('option', { value: 'starttls', selected: mail.security === 'starttls' }, 'STARTTLS (обычно порт 587)'),
              h('option', { value: 'tls', selected: mail.security === 'tls' }, 'TLS сразу (порт 465)'),
              h('option', { value: 'none', selected: mail.security === 'none' }, 'Без шифрования'))),
          field('Логин', 'user', 'user@example.com или company\\user'),
          labeled(passwordSaved ? 'Пароль (сохранён, можно заменить)' : 'Пароль',
            h('input', {
              class: 'field',
              type: 'password',
              placeholder: passwordSaved ? '•••••••• — оставьте пустым, чтобы не менять' : 'пароль от почты',
              autocomplete: 'off',
              oninput: (ev) => { mailPassword = ev.target.value; },
            })),
          field('Адрес отправителя', 'from', 'если отличается от логина'),
          field('Имя отправителя', 'fromName', 'например, ИТ-отдел'),
          field('Копия (Cc)', 'cc', 'почта коллеги — уйдёт копия каждого письма')),
        labeled('Тема письма', h('input', {
          class: 'field',
          value: mail.subject || '',
          oninput: (ev) => { mail.subject = ev.target.value; },
        })),
        labeled('Текст письма — подстановки {ФИО}, {Имя}, {Фамилия}, {Архив}',
          h('textarea', {
            class: 'field',
            rows: '8',
            value: mail.template || '',
            oninput: (ev) => { mail.template = ev.target.value; },
          })),
        h('div', { class: 'row' },
          h('button', {
            class: 'btn small',
            onclick: async (ev) => {
              const button = ev.currentTarget;
              button.disabled = true;
              mailCheck = 'проверяю…';
              draw();
              // пароль проверяем тот, что уже введён в поле
              if (mailPassword !== null) await api.saveMailPassword(mailPassword);
              mailPassword = null;
              await api.saveSettings({ ...draft });
              const res = await api.testMail();
              mailCheck = res.ok ? 'Подключение и вход прошли успешно' : `Не вышло: ${res.error}`;
              passwordSaved = await api.hasMailPassword();
              draw();
            },
          }, 'Проверить подключение'),
          passwordSaved
            ? h('button', {
              class: 'btn small ghost danger',
              onclick: async () => { await api.saveMailPassword(''); passwordSaved = false; mailCheck = 'Пароль удалён'; draw(); },
            }, 'Удалить пароль')
            : null,
          mailCheck ? h('span', { class: 'hint' }, mailCheck) : null),
        h('span', { class: 'hint' }, 'Пароль от архива в письмо не подставляется — его вы передаёте отдельно')));
  }

  function validateAndClean() {
    if (!draft.systems.length) return 'Нужна хотя бы одна система';
    if (!draft.profiles.length) return 'Нужен хотя бы один профиль оформления';
    for (const s of draft.systems) {
      s.name = String(s.name || '').trim();
      s.url = String(s.url || '').trim();
      s.domainPrefix = String(s.domainPrefix || '').trim();
      s.rdp = Boolean(s.rdp);
      s.steps = (s.steps || []).map((x) => x.trim()).filter(Boolean);
      if (!s.name) return 'У каждой системы должно быть название';
    }
    for (const p of draft.profiles) {
      p.name = String(p.name || '').trim();
      p.company = String(p.company || '').trim();
      p.support = String(p.support || '').trim();
      p.note = String(p.note || '').trim();
      if (!p.name) return 'У каждого профиля должно быть название';
    }
    if (!draft.profiles.some((p) => p.id === draft.defaultProfileId)) draft.defaultProfileId = draft.profiles[0].id;
    if (!['system', 'light', 'dark', 'kawaii'].includes(draft.theme)) draft.theme = 'system';
    const mail = draft.mail || (draft.mail = {});
    for (const key of ['host', 'user', 'from', 'fromName', 'cc', 'subject', 'template']) {
      mail[key] = String(mail[key] || '').trim();
    }
    mail.port = Math.min(65535, Math.max(1, Number(mail.port) || 587));
    if (!['starttls', 'tls', 'none'].includes(mail.security)) mail.security = 'starttls';
    if (!mascotList.some((m) => m.id === draft.mascot)) draft.mascot = '';
    for (const key of ['mascotOpacity', 'backgroundDim']) {
      draft[key] = Math.min(100, Math.max(0, Number(draft[key]) || 0));
    }
    return '';
  }

  async function save() {
    error = validateAndClean();
    if (error) {
      draw();
      return;
    }
    if (mailPassword !== null) {
      try {
        await api.saveMailPassword(mailPassword);
        mailPassword = null;
      } catch (err) {
        error = String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        draw();
        return;
      }
    }
    onSave(draft);
  }

  function draw() {
    root.replaceChildren(
      h('header', { class: 'topbar' },
        h('div', { class: 'brand' }, icon('settings'), 'Настройки'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn ghost', onclick: onCancel }, 'Отмена'),
        h('button', { class: 'btn primary', onclick: save }, 'Сохранить')),
      error && h('div', { class: 'notice error' }, h('span', {}, error)),
      h('main', { class: 'settings-body' },
        h('section', { class: 'section' },
          h('h2', {}, 'Системы'),
          h('span', { class: 'hint' }, 'Выпадающий список учёток и блоки инструкции в PDF'),
          draft.systems.map(systemCard),
          h('button', {
            class: 'btn dashed',
            onclick: () => {
              draft.systems.push({ id: crypto.randomUUID(), name: '', url: '', domainPrefix: '', rdp: false, steps: [] });
              draw();
            },
          }, icon('plus'), 'Система')),
        h('section', { class: 'section' },
          h('h2', {}, 'Оформление PDF'),
          h('span', { class: 'hint' }, 'Шапка и подвал документа с доступами'),
          draft.profiles.map(profileCard),
          h('button', {
            class: 'btn dashed',
            onclick: () => {
              draft.profiles.push({ id: crypto.randomUUID(), name: '', company: '', logoFile: '', support: '', note: '' });
              draw();
            },
          }, icon('plus'), 'Профиль'),
          h('div', { class: 'card settings-card' },
            labeled('Профиль по умолчанию',
              h('select', { class: 'field', onchange: (ev) => { draft.defaultProfileId = ev.target.value; } },
                draft.profiles.map((p) => h('option', { value: p.id, selected: p.id === draft.defaultProfileId }, p.name || 'без названия')))))),
        h('section', { class: 'section' },
          h('h2', {}, 'Папки и шифрование'),
          h('span', { class: 'hint' }, 'Шифрование можно поменять и перед каждой сборкой'),
          h('div', { class: 'card settings-card' },
            pathRow('Библиотека вложений', 'libraryPath'),
            pathRow('Папка для архивов', 'outputPath'),
            labeled('Шифрование по умолчанию',
              h('select', { class: 'field', onchange: (ev) => { draft.encryption = ev.target.value; } },
                h('option', { value: 'zipcrypto', selected: draft.encryption === 'zipcrypto' }, 'ZipCrypto — откроет Проводник Windows'),
                h('option', { value: 'aes256', selected: draft.encryption === 'aes256' }, 'AES-256 — нужен 7-Zip; устойчив к атаке по известному файлу'))))),
        mailSection(),
        appearanceSection(),
        transferSection(),
        updatesSection()));
  }

  draw();
  api.mascots().then((list) => { mascotList = list; draw(); });
  api.hasMailPassword().then((has) => { passwordSaved = has; draw(); });
  return root;
}
