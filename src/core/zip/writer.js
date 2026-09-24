'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const zlib = require('node:zlib');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { ZipCryptoEncryptor } = require('./zipcrypto');
const { WinZipAesEncryptor } = require('./aes');

const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const METHOD_AES = 99;
const MAX32 = 0xffffffff;
const METHODS = ['zipcrypto', 'aes256'];

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function aesExtra() {
  const b = Buffer.alloc(11);
  b.writeUInt16LE(0x9901, 0); // WinZip AES
  b.writeUInt16LE(7, 2); // размер данных
  b.writeUInt16LE(2, 4); // AE-2
  b.write('AE', 6, 'ascii');
  b.writeUInt8(3, 8); // AES-256
  b.writeUInt16LE(METHOD_DEFLATE, 9); // реальный метод сжатия
  return b;
}

function localHeader(e) {
  const b = Buffer.alloc(30);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(e.version, 4);
  b.writeUInt16LE(e.flags, 6);
  b.writeUInt16LE(e.method, 8);
  b.writeUInt16LE(e.time, 10);
  b.writeUInt16LE(e.date, 12);
  b.writeUInt32LE(e.crc >>> 0, 14);
  b.writeUInt32LE(e.csize, 18);
  b.writeUInt32LE(e.usize, 22);
  b.writeUInt16LE(e.nameBuf.length, 26);
  b.writeUInt16LE(e.extra.length, 28);
  return Buffer.concat([b, e.nameBuf, e.extra]);
}

function centralHeader(e) {
  const b = Buffer.alloc(46);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(e.version, 4); // made by: MS-DOS
  b.writeUInt16LE(e.version, 6); // version needed
  b.writeUInt16LE(e.flags, 8);
  b.writeUInt16LE(e.method, 10);
  b.writeUInt16LE(e.time, 12);
  b.writeUInt16LE(e.date, 14);
  b.writeUInt32LE(e.crc >>> 0, 16);
  b.writeUInt32LE(e.csize, 20);
  b.writeUInt32LE(e.usize, 24);
  b.writeUInt16LE(e.nameBuf.length, 28);
  b.writeUInt16LE(e.extra.length, 30);
  b.writeUInt16LE(0, 32); // комментарий
  b.writeUInt16LE(0, 34); // диск
  b.writeUInt16LE(0, 36); // внутренние атрибуты
  b.writeUInt32LE(e.external, 38);
  b.writeUInt32LE(e.offset, 42);
  return Buffer.concat([b, e.nameBuf, e.extra]);
}

async function crcOfFile(srcPath) {
  let crc = 0;
  for await (const chunk of fs.createReadStream(srcPath)) crc = zlib.crc32(chunk, crc);
  return crc;
}

class ZipWriter {
  static async create(filePath, { password, method }) {
    if (!password) throw new Error('Нужен пароль архива');
    if (!METHODS.includes(method)) throw new Error(`Неизвестное шифрование: ${method}`);
    const fh = await fsp.open(filePath, 'wx');
    return new ZipWriter(filePath, fh, password, method);
  }

  constructor(filePath, fh, password, method) {
    this.filePath = filePath;
    this.fh = fh;
    this.password = password;
    this.method = method;
    this.offset = 0;
    this.entries = [];
    this.names = new Set();
  }

  async #writeAt(buf, position) {
    let done = 0;
    while (done < buf.length) {
      const { bytesWritten } = await this.fh.write(buf, done, buf.length - done, position + done);
      done += bytesWritten;
    }
  }

  async #append(buf) {
    await this.#writeAt(buf, this.offset);
    this.offset += buf.length;
  }

  #claim(name) {
    const normalized = name.replace(/\\/g, '/');
    const key = normalized.toLowerCase();
    if (this.names.has(key)) throw new Error(`Два файла с одним именем в архиве: ${normalized}`);
    this.names.add(key);
    return Buffer.from(normalized, 'utf8');
  }

  async addDirectory(name, mtime = new Date()) {
    const nameBuf = this.#claim(name.endsWith('/') ? name : `${name}/`);
    const entry = {
      nameBuf,
      ...dosDateTime(mtime),
      flags: FLAG_UTF8,
      method: METHOD_STORE,
      version: 20,
      crc: 0,
      csize: 0,
      usize: 0,
      extra: Buffer.alloc(0),
      external: 0x10,
      offset: this.offset,
    };
    await this.#append(localHeader(entry));
    this.entries.push(entry);
  }

  async addBuffer(name, buf, mtime = new Date()) {
    await this.#addEntry(name, zlib.crc32(buf), buf.length, () => Readable.from([buf]), mtime);
  }

  async addFile(name, srcPath) {
    const st = await fsp.stat(srcPath);
    if (st.size >= MAX32) throw new Error(`Файл больше 4 ГБ: ${name}`);
    const crc = this.method === 'aes256' ? 0 : await crcOfFile(srcPath);
    await this.#addEntry(name, crc, st.size, () => fs.createReadStream(srcPath), st.mtime);
  }

  async #addEntry(name, crc, usize, openStream, mtime) {
    const nameBuf = this.#claim(name);
    const aes = this.method === 'aes256';
    const entry = {
      nameBuf,
      ...dosDateTime(mtime),
      flags: FLAG_UTF8 | FLAG_ENCRYPTED,
      method: aes ? METHOD_AES : METHOD_DEFLATE,
      version: aes ? 51 : 20,
      crc: aes ? 0 : crc, // AE-2 не хранит CRC
      csize: 0,
      usize,
      extra: aes ? aesExtra() : Buffer.alloc(0),
      external: 0,
      offset: this.offset,
    };
    await this.#append(localHeader(entry)); // размер допишем после данных
    const dataStart = this.offset;

    const enc = aes ? new WinZipAesEncryptor(this.password) : new ZipCryptoEncryptor(this.password);
    await this.#append(aes ? enc.prefix() : enc.header(crc));
    const self = this;
    await pipeline(
      openStream(),
      zlib.createDeflateRaw({ level: 9 }),
      new Transform({
        transform(chunk, _enc, cb) {
          cb(null, enc.encrypt(chunk));
        },
      }),
      async function (source) {
        for await (const chunk of source) await self.#append(chunk);
      },
    );
    if (aes) await this.#append(enc.finish());

    entry.csize = this.offset - dataStart;
    if (entry.csize >= MAX32 || this.offset >= MAX32) throw new Error('Архив больше 4 ГБ');
    await this.#writeAt(localHeader(entry), entry.offset);
    this.entries.push(entry);
  }

  async close() {
    if (this.entries.length > 0xffff) throw new Error('Слишком много файлов в архиве');
    const cdStart = this.offset;
    for (const e of this.entries) await this.#append(centralHeader(e));
    const cdSize = this.offset - cdStart;
    if (this.offset >= MAX32) throw new Error('Архив больше 4 ГБ');
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    await this.#append(eocd);
    await this.fh.close();
  }

  async abort() {
    try {
      await this.fh.close();
    } catch {
      // уже закрыт
    }
    await fsp.rm(this.filePath, { force: true });
  }
}

module.exports = { ZipWriter };
