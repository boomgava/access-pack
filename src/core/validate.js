(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APValidate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // requireEmail — включена галочка «отправить письма после сборки»:
  // тогда адрес получателя обязателен и проверяется на опечатки
  function validateBatch(employees, systems, { requireEmail = false } = {}) {
    const errors = [];
    const systemIds = new Set(systems.map((s) => s.id));
    if (employees.length === 0) {
      errors.push({ field: 'batch', message: 'Добавьте хотя бы одного сотрудника' });
    }
    for (const emp of employees) {
      if (!String(emp.fio || '').trim()) {
        errors.push({ employeeId: emp.id, field: 'fio', message: 'Укажите ФИО' });
      }
      if (emp.accounts.length === 0) {
        errors.push({ employeeId: emp.id, field: 'accounts', message: 'Добавьте хотя бы одну учётку' });
      }
      if (requireEmail) {
        const email = String(emp.email || '').trim();
        if (!email) errors.push({ employeeId: emp.id, field: 'email', message: 'Укажите почту для отправки' });
        else if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(email)) {
          errors.push({ employeeId: emp.id, field: 'email', message: 'Проверьте адрес почты' });
        }
      }
      for (const acc of emp.accounts) {
        const at = { employeeId: emp.id, accountId: acc.id };
        if (!systemIds.has(acc.systemId)) errors.push({ ...at, field: 'system', message: 'Выберите систему' });
        if (!String(acc.login || '').trim()) errors.push({ ...at, field: 'login', message: 'Укажите логин' });
        if (!acc.password) errors.push({ ...at, field: 'password', message: 'Укажите пароль' });
      }
    }
    return errors;
  }

  return { validateBatch };
});
