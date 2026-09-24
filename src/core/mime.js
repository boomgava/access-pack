'use strict';

// Сборка письма по RFC 5322: заголовки, текст и вложения.
// Всё в base64: и текст, и файлы — так не нужно возиться с quoted-printable
// и переносами строк, а русские имена файлов и темы кодируются по RFC 2047/2231.

const CRLF = '\r\n';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const isAscii = (s) => /^[\x20-\x7e]*$/.test(s);

// =?UTF-8?B?…?= — иначе русская тема приедет крякозябрами
function encodeWord(text) {
  const value = String(text ?? '');
  if (isAscii(value)) return value;
  // 45 байт на строку: с обвязкой =?UTF-8?B?…?= укладываемся в лимит 76 символов
  const chunks = [];
  let chunk = Buffer.alloc(0);
  for (const ch of value) {
    const bytes = Buffer.from(ch, 'utf8');
    if (chunk.length + bytes.length > 45) {
      chunks.push(chunk);
      chunk = Buffer.alloc(0);
    }
    chunk = Buffer.concat([chunk, bytes]);
  }
  if (chunk.length) chunks.push(chunk);
  return chunks.map((c) => `=?UTF-8?B?${c.toString('base64')}?=`).join(`${CRLF} `);
}

// «Имя» <адрес>; имя кодируется, если не латиница
function formatAddress(addr) {
  if (typeof addr === 'string') return addr.trim();
  const email = String(addr.email || '').trim();
  const name = String(addr.name || '').trim();
  if (!name) return email;
  return `${isAscii(name) ? `"${name.replace(/"/g, '')}"` : encodeWord(name)} <${email}>`;
}

function addressList(list) {
  return (Array.isArray(list) ? list : [list]).filter(Boolean).map(formatAddress).join(', ');
}

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${DAYS[d.getDay()]}, ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
  );
}

const wrap = (b64) => b64.match(/.{1,76}/g)?.join(CRLF) ?? '';

// Имя файла: латиница — как есть, иначе RFC 2231 (filename*=UTF-8''…)
function fileNameParams(name) {
  if (isAscii(name)) return `filename="${name.replace(/"/g, '')}"`;
  return `filename*=UTF-8''${encodeURIComponent(name)}`;
}

function buildMessage({ from, to, cc = [], subject = '', text = '', attachments = [], date = new Date(), messageId }) {
  const boundary = `----accesspack-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const id = messageId || `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@access-pack>`;
  const headers = [
    `From: ${formatAddress(from)}`,
    `To: ${addressList(to)}`,
    cc && (Array.isArray(cc) ? cc.length : cc) ? `Cc: ${addressList(cc)}` : null,
    `Subject: ${encodeWord(subject)}`,
    `Date: ${formatDate(date)}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
  ].filter(Boolean);

  const body = Buffer.from(String(text).replace(/\r?\n/g, CRLF), 'utf8').toString('base64');
  if (!attachments.length) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    return [...headers, '', wrap(body)].join(CRLF);
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap(body)].join(CRLF),
    ...attachments.map((a) =>
      [
        // длинные параметры переносим на строку с отступом — так требует RFC 5322
        `Content-Type: ${a.contentType || 'application/octet-stream'};${CRLF}\t${fileNameParams(a.filename)}`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment;${CRLF}\t${fileNameParams(a.filename)}`,
        '',
        wrap(Buffer.from(a.content).toString('base64')),
      ].join(CRLF),
    ),
  ];
  return [
    ...headers,
    '',
    'Письмо в формате MIME.',
    ...parts.flatMap((p) => [`--${boundary}`, p]),
    `--${boundary}--`,
    '',
  ].join(CRLF);
}

// Адрес проверяем мягко: задача — поймать опечатку, а не отвергнуть редкий валидный адрес
function isEmail(value) {
  const v = String(value || '').trim();
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(v);
}

// «a@b.ru, c@d.ru» → ['a@b.ru', 'c@d.ru']
function parseAddresses(value) {
  return String(value || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = { buildMessage, encodeWord, formatAddress, addressList, isEmail, parseAddresses, formatDate };
