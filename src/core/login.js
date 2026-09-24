(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APLogin = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Логин в том виде, в каком его вводят: префикс домена добавляется,
  // если логин ещё не полный (нет «\» и «@»)
  function fullLogin(login, system) {
    const value = String(login || '').trim();
    let prefix = system && system.domainPrefix ? String(system.domainPrefix).trim() : '';
    if (!prefix || value.includes('\\') || value.includes('@')) return value;
    if (!prefix.endsWith('\\')) prefix += '\\';
    return prefix + value;
  }

  return { fullLogin };
});
