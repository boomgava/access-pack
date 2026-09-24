'use strict';
const { fullLogin } = require('./login');

// Из результата сборки делает записи истории: только удачные архивы,
// логины — в том же виде, что в PDF, пароли учёток не сохраняются.
function historyEntries({ results, employees, systems, attachments = [], folder = '', encryption = '' }) {
  const bySystem = new Map(systems.map((s) => [s.id, s]));
  const names = attachments.map((p) => String(p).split(/[\\/]/).pop());
  return results
    .map((r, i) => ({ r, emp: employees[i] }))
    .filter(({ r, emp }) => r && !r.error && emp)
    .map(({ r, emp }) => ({
      fio: r.fio,
      archive: r.archive,
      password: r.password,
      folder,
      encryption,
      accounts: emp.accounts.map((a) => {
        const system = bySystem.get(a.systemId);
        return { system: system ? system.name : a.systemId, login: fullLogin(a.login, system) };
      }),
      attachments: names,
    }));
}

module.exports = { historyEntries };
