'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { sendMail, testConnection, stuffDots } = require('../src/main/smtp');

// Поддельный SMTP-сервер: отвечает по сценарию и запоминает весь разговор.
// script — массив ответов на команды по порядку; greeting уходит сразу при подключении.
function fakeServer({ greeting = '220 fake ESMTP', replies = {}, ehlo = ['250-fake', '250-AUTH LOGIN PLAIN', '250 OK'] } = {}) {
  const log = [];
  let dataMode = false;
  let message = '';
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write(`${greeting}\r\n`);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (dataMode) {
          if (line === '.') {
            dataMode = false;
            socket.write(`${replies.DATA_END || '250 2.0.0 Ok: queued as 12345'}\r\n`);
          } else {
            message += `${line}\r\n`;
          }
          continue;
        }
        log.push(line);
        const verb = line.split(/[ :]/)[0].toUpperCase();
        if (verb === 'EHLO') {
          socket.write(`${ehlo.join('\r\n')}\r\n`);
        } else if (verb === 'DATA') {
          socket.write(`${replies.DATA || '354 End data with <CRLF>.<CRLF>'}\r\n`);
          if ((replies.DATA || '354').startsWith('354')) dataMode = true;
        } else if (verb === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        } else if (verb === 'AUTH') {
          socket.write(`${replies.AUTH || '334 VXNlcm5hbWU6'}\r\n`);
        } else if (/^[A-Za-z0-9+/=]+$/.test(line) && !replies.stopAuth) {
          // base64 от логина или пароля
          const decoded = Buffer.from(line, 'base64').toString('utf8');
          log.push(`base64:${decoded}`);
          socket.write(`${log.filter((l) => l.startsWith('base64:')).length === 1 ? '334 UGFzc3dvcmQ6' : replies.AUTH_DONE || '235 2.7.0 Authentication successful'}\r\n`);
        } else {
          socket.write(`${replies[verb] || '250 OK'}\r\n`);
        }
      }
    });
    socket.on('error', () => {});
  });
  return {
    server,
    log,
    get message() {
      return message;
    },
    listen() {
      return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

test('письмо уходит: весь разговор по протоколу и вложение на месте', async () => {
  const fake = fakeServer();
  const port = await fake.listen();
  try {
    const result = await sendMail({
      host: '127.0.0.1',
      port,
      security: 'none',
      user: 'ivanov@example.com',
      password: 'секрет',
      from: { name: 'ИТ-отдел', email: 'ivanov@example.com' },
      to: 'korchak@example.net',
      cc: 'kollega@example.com',
      subject: 'Доступы',
      text: 'Доброго дня!',
      attachments: [{ filename: 'Корчак_Александр.zip', content: Buffer.from('PK'), contentType: 'application/zip' }],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.recipients, ['korchak@example.net', 'kollega@example.com']);
    const commands = fake.log.filter((l) => !l.startsWith('base64:'));
    assert.ok(commands[0].startsWith('EHLO'), commands[0]);
    assert.ok(commands.includes('AUTH LOGIN'));
    assert.ok(commands.includes('MAIL FROM:<ivanov@example.com>'));
    assert.ok(commands.includes('RCPT TO:<korchak@example.net>'), 'получатель');
    assert.ok(commands.includes('RCPT TO:<kollega@example.com>'), 'копия тоже уходит в RCPT');
    assert.ok(commands.includes('DATA'));
    assert.deepEqual(fake.log.filter((l) => l.startsWith('base64:')), ['base64:ivanov@example.com', 'base64:секрет']);
    assert.ok(fake.message.includes('Cc: kollega@example.com'));
    assert.ok(fake.message.includes("filename*=UTF-8''%D0%9A"), 'русское имя вложения');
  } finally {
    await fake.close();
  }
});

test('точка в начале строки удваивается на уровне транспорта', () => {
  assert.equal(stuffDots('строка\r\n.точка\r\nконец'), 'строка\r\n..точка\r\nконец');
  assert.equal(stuffDots('.'), '..');
  assert.equal(stuffDots('обычный текст'), 'обычный текст');
});

test('текст письма доезжает без искажений', async () => {
  const fake = fakeServer();
  const port = await fake.listen();
  try {
    const text = 'строка\n.точка в начале\nконец';
    await sendMail({ host: '127.0.0.1', port, security: 'none', from: 'a@b.ru', to: 'c@d.ru', text });
    const body = fake.message.split('\r\n\r\n')[1].trim().split('\r\n').join('');
    assert.equal(Buffer.from(body, 'base64').toString('utf8'), text.replace(/\n/g, '\r\n'));
  } finally {
    await fake.close();
  }
});

test('неверный пароль — понятная ошибка с текстом сервера', async () => {
  const fake = fakeServer({ replies: { AUTH_DONE: '535 5.7.8 Authentication credentials invalid' } });
  const port = await fake.listen();
  try {
    await assert.rejects(
      sendMail({ host: '127.0.0.1', port, security: 'none', user: 'u', password: 'неверный', from: 'a@b.ru', to: 'c@d.ru' }),
      (err) => {
        assert.match(err.message, /вход: пароль/);
        assert.match(err.message, /535/);
        assert.equal(err.code, 535);
        return true;
      },
    );
  } finally {
    await fake.close();
  }
});

test('получателя отвергли — в ошибке видно, кого именно', async () => {
  const fake = fakeServer({ replies: { RCPT: '550 5.1.1 User unknown' } });
  const port = await fake.listen();
  try {
    await assert.rejects(
      sendMail({ host: '127.0.0.1', port, security: 'none', from: 'a@b.ru', to: 'опечатка@example.net' }),
      /получатель опечатка@example\.net/,
    );
  } finally {
    await fake.close();
  }
});

test('проверка настроек доходит до авторизации и возвращает возможности сервера', async () => {
  const fake = fakeServer();
  const port = await fake.listen();
  try {
    const res = await testConnection({ host: '127.0.0.1', port, security: 'none', user: 'u', password: 'p' });
    assert.equal(res.ok, true);
    assert.ok(res.capabilities.some((c) => c.includes('AUTH')));
    assert.ok(!fake.log.includes('DATA'), 'проверка ничего не отправляет');
  } finally {
    await fake.close();
  }
});

test('сервер недоступен — ошибка про подключение, а не стек', async () => {
  await assert.rejects(
    sendMail({ host: '127.0.0.1', port: 1, security: 'none', from: 'a@b.ru', to: 'c@d.ru', timeout: 2000 }),
    /Не удалось подключиться к 127\.0\.0\.1:1/,
  );
});

test('пустые настройки отсекаются до подключения', async () => {
  await assert.rejects(sendMail({ from: 'a@b.ru', to: 'c@d.ru' }), /Не указан SMTP-сервер/);
  await assert.rejects(sendMail({ host: 'x', to: 'c@d.ru' }), /Не указан адрес отправителя/);
  await assert.rejects(sendMail({ host: 'x', from: 'a@b.ru', to: '' }), /Нет ни одного получателя/);
});
