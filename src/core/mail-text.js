(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APMailText = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Шаблон письма с подстановками. Неизвестные фигурные скобки не трогаем:
  // пусть лучше человек увидит их в тексте, чем мы молча съедим часть письма.
  function renderTemplate(template, { fio = '', archive = '' } = {}) {
    const words = String(fio).trim().split(/\s+/).filter(Boolean);
    const values = {
      'ФИО': String(fio).trim(),
      'Имя': words[1] || words[0] || '',
      'Фамилия': words[0] || '',
      'Архив': String(archive),
    };
    return String(template || '').replace(/\{([^{}]+)\}/g, (whole, key) => {
      const value = values[key.trim()];
      return value === undefined ? whole : value;
    });
  }

  // У архивов без пароля свой текст письма; если его стёрли — берём обычный
  function pickTemplate(mail, { noPassword = false } = {}) {
    const m = mail || {};
    if (!noPassword) return m.template || '';
    return m.templateNoPassword || m.template || '';
  }

  return { renderTemplate, pickTemplate };
});
