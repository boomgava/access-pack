'use strict';

const pad = (n) => String(n).padStart(2, '0');

function formatDate(d) {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function formatDateTime(d) {
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = { pad, formatDate, formatDateTime };
