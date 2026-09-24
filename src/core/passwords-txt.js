'use strict';
const { formatDateTime } = require('./format');

const ENCRYPTION_LABEL = { zipcrypto: 'ZipCrypto', aes256: 'AES-256' };

// UTF-8 с BOM и CRLF — чтобы Блокнот на любой Windows открыл без кракозябр
function formatPasswordsTxt({ date, encryption, results }) {
  const built = results.filter((r) => !r.error).length;
  const lines = [
    `Доступы от ${formatDateTime(date)} · архивов: ${built} · шифрование: ${ENCRYPTION_LABEL[encryption] || encryption}`,
    '',
  ];
  for (const r of results) {
    lines.push(r.fio);
    if (r.error) {
      lines.push(`  НЕ СОБРАН: ${r.error}`);
    } else {
      lines.push(`  Архив:  ${r.archive}`);
      lines.push(`  Пароль: ${r.password}`);
    }
    lines.push('');
  }
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join('\r\n'), 'utf8')]);
}

module.exports = { formatPasswordsTxt };
