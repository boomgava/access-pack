'use strict';
const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');
const { buildMessage, parseAddresses } = require('../core/mime');

// Минимальный SMTP-клиент: EHLO → STARTTLS → AUTH → MAIL/RCPT/DATA → QUIT.
// Внешних зависимостей в проекте нет, поэтому разговор с сервером ведём сами.

const CRLF = '\r\n';
const DEFAULT_TIMEOUT = 30000;

class SmtpError extends Error {
  constructor(message, { code = 0, stage = '' } = {}) {
    super(message);
    this.code = code;
    this.stage = stage;
  }
}

// Ответ сервера бывает многострочным: «250-ЧТО-ТО» … «250 ПОСЛЕДНЯЯ СТРОКА»
function parseReply(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  return { code: Number(last.slice(0, 3)) || 0, lines, text: lines.join('\n') };
}

class Session {
  constructor(socket, timeout) {
    this.socket = socket;
    this.timeout = timeout;
    this.buffer = '';
    this.waiter = null;
    this.failure = null;
    this.bind();
  }

  bind() {
    this.socket.setEncoding('utf8');
    this.onData = (chunk) => {
      this.buffer += chunk;
      // ответ закончен, когда пришла строка вида «250 текст» (пробел после кода)
      if (/(^|\n)\d{3} [^\n]*\r?\n$/.test(this.buffer) && this.waiter) {
        const { resolve } = this.waiter;
        this.waiter = null;
        const text = this.buffer;
        this.buffer = '';
        resolve(parseReply(text));
      }
    };
    this.onError = (err) => {
      this.failure = err;
      if (this.waiter) {
        const { reject } = this.waiter;
        this.waiter = null;
        reject(new SmtpError(`Сбой соединения: ${err.message}`, { stage: 'connect' }));
      }
    };
    this.socket.on('data', this.onData);
    this.socket.on('error', this.onError);
    this.socket.on('close', () => this.onError(this.failure || new Error('соединение закрыто')));
  }

  unbind() {
    this.socket.removeListener('data', this.onData);
    this.socket.removeListener('error', this.onError);
  }

  read(stage) {
    if (this.failure) return Promise.reject(new SmtpError(`Сбой соединения: ${this.failure.message}`, { stage }));
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new SmtpError(`Сервер молчит дольше ${Math.round(this.timeout / 1000)} с`, { stage }));
      }, this.timeout);
      const done = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      this.waiter = { resolve: done(resolve), reject: done(reject) };
    });
  }

  // expect — ожидаемые коды ответа; всё остальное считаем ошибкой с текстом от сервера
  async say(command, expect, stage, { secret = false } = {}) {
    this.socket.write(command + CRLF);
    const reply = await this.read(stage);
    if (expect && !expect.includes(reply.code)) {
      throw new SmtpError(`${stage}: сервер ответил «${reply.text}»`, { code: reply.code, stage });
    }
    void secret;
    return reply;
  }
}

// Точка в начале строки удваивается, иначе она оборвёт передачу письма.
// Тело у нас в base64, так что случай редкий — но транспорт обязан быть честным.
const stuffDots = (message) => message.split(CRLF).map((line) => (line.startsWith('.') ? `.${line}` : line)).join(CRLF);

function connect({ host, port, security, timeout }) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(new SmtpError(`Не удалось подключиться к ${host}:${port} — ${err.message}`, { stage: 'connect' }));
    const socket = security === 'tls'
      ? tls.connect({ host, port, servername: host }, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket));
    socket.setTimeout(timeout, () => onError(new Error('таймаут подключения')));
    socket.once('error', onError);
  });
}

function upgrade(socket, host, timeout) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host }, () => resolve(secure));
    secure.setTimeout(timeout);
    secure.once('error', (err) => reject(new SmtpError(`STARTTLS не удался: ${err.message}`, { stage: 'starttls' })));
  });
}

async function authenticate(session, capabilities, user, password) {
  if (!user) return;
  if (!password) throw new SmtpError('Не задан пароль почты — укажите его в настройках', { stage: 'вход' });
  const caps = capabilities.join(' ').toUpperCase();
  if (caps.includes('AUTH') && caps.includes('LOGIN')) {
    await session.say('AUTH LOGIN', [334], 'вход');
    await session.say(Buffer.from(user, 'utf8').toString('base64'), [334], 'вход: логин');
    await session.say(Buffer.from(password, 'utf8').toString('base64'), [235], 'вход: пароль', { secret: true });
    return;
  }
  const plain = Buffer.from(`\0${user}\0${password}`, 'utf8').toString('base64');
  await session.say(`AUTH PLAIN ${plain}`, [235], 'вход', { secret: true });
}

// Одно письмо за одно соединение: партии маленькие, зато меньше странных состояний
async function sendMail(options) {
  const {
    host,
    port = 587,
    security = 'starttls',
    user = '',
    password = '',
    from,
    to,
    cc = [],
    subject = '',
    text = '',
    attachments = [],
    timeout = DEFAULT_TIMEOUT,
    date,
  } = options;
  if (!host) throw new SmtpError('Не указан SMTP-сервер', { stage: 'настройки' });
  const fromEmail = typeof from === 'string' ? from : from && from.email;
  if (!fromEmail) throw new SmtpError('Не указан адрес отправителя', { stage: 'настройки' });
  const recipients = [...parseAddresses(Array.isArray(to) ? to.join(',') : to), ...parseAddresses(Array.isArray(cc) ? cc.join(',') : cc)];
  if (!recipients.length) throw new SmtpError('Нет ни одного получателя', { stage: 'настройки' });

  let socket = await connect({ host, port, security, timeout });
  let session = new Session(socket, timeout);
  try {
    await session.read('приветствие');
    const hello = os.hostname() || 'access-pack';
    let ehlo = await session.say(`EHLO ${hello}`, [250], 'EHLO');
    if (security === 'starttls') {
      await session.say('STARTTLS', [220], 'STARTTLS');
      session.unbind();
      socket = await upgrade(socket, host, timeout);
      session = new Session(socket, timeout);
      ehlo = await session.say(`EHLO ${hello}`, [250], 'EHLO после STARTTLS');
    }
    await authenticate(session, ehlo.lines, user, password);
    await session.say(`MAIL FROM:<${fromEmail}>`, [250], 'MAIL FROM');
    for (const rcpt of recipients) await session.say(`RCPT TO:<${rcpt}>`, [250, 251], `получатель ${rcpt}`);
    await session.say('DATA', [354], 'DATA');
    const message = buildMessage({ from, to, cc, subject, text, attachments, date });
    socket.write(stuffDots(message) + CRLF + '.' + CRLF);
    const accepted = await session.read('отправка письма');
    if (accepted.code !== 250) throw new SmtpError(`Письмо не принято: «${accepted.text}»`, { code: accepted.code, stage: 'отправка письма' });
    try {
      await session.say('QUIT', null, 'QUIT');
    } catch {
      // сервер может закрыть соединение не ответив — письмо уже принято
    }
    return { ok: true, response: accepted.text, recipients };
  } finally {
    session.unbind();
    socket.destroy();
  }
}

// Проверка настроек: доходим до авторизации и уходим, письма не отправляем
async function testConnection(options) {
  const { host, port = 587, security = 'starttls', user = '', password = '', timeout = DEFAULT_TIMEOUT } = options;
  if (!host) throw new SmtpError('Не указан SMTP-сервер', { stage: 'настройки' });
  let socket = await connect({ host, port, security, timeout });
  let session = new Session(socket, timeout);
  try {
    await session.read('приветствие');
    const hello = os.hostname() || 'access-pack';
    let ehlo = await session.say(`EHLO ${hello}`, [250], 'EHLO');
    if (security === 'starttls') {
      await session.say('STARTTLS', [220], 'STARTTLS');
      session.unbind();
      socket = await upgrade(socket, host, timeout);
      session = new Session(socket, timeout);
      ehlo = await session.say(`EHLO ${hello}`, [250], 'EHLO после STARTTLS');
    }
    await authenticate(session, ehlo.lines, user, password);
    try {
      await session.say('QUIT', null, 'QUIT');
    } catch {
      // не важно, как сервер прощается
    }
    return { ok: true, capabilities: ehlo.lines.slice(1) };
  } finally {
    session.unbind();
    socket.destroy();
  }
}

module.exports = { sendMail, testConnection, SmtpError, parseReply, stuffDots };
