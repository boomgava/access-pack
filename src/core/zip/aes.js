'use strict';
const { randomBytes, pbkdf2Sync, createCipheriv, createHmac } = require('node:crypto');

const SALT_LEN = 16; // для AES-256
const KEY_LEN = 32;
const BLOCK = 16;
const BATCH_BLOCKS = 4096; // 64 КБ ключевого потока за раз

// WinZip AE-2: AES-256-CTR со счётчиком little-endian от 1, HMAC-SHA1 по шифротексту
class WinZipAesEncryptor {
  constructor(password) {
    this.salt = randomBytes(SALT_LEN);
    const dk = pbkdf2Sync(Buffer.from(password, 'utf8'), this.salt, 1000, KEY_LEN * 2 + 2, 'sha1');
    this.ecb = createCipheriv('aes-256-ecb', dk.subarray(0, KEY_LEN), null);
    this.ecb.setAutoPadding(false);
    this.hmac = createHmac('sha1', dk.subarray(KEY_LEN, KEY_LEN * 2));
    this.verifier = dk.subarray(KEY_LEN * 2);
    this.blockNo = 0;
    this.keystream = Buffer.alloc(0);
    this.pos = 0;
  }

  // Пишется перед данными: соль + 2 байта проверки пароля
  prefix() {
    return Buffer.concat([this.salt, this.verifier]);
  }

  #refill() {
    const counters = Buffer.alloc(BATCH_BLOCKS * BLOCK);
    for (let i = 0; i < BATCH_BLOCKS; i++) {
      this.blockNo += 1;
      counters.writeUInt32LE(this.blockNo >>> 0, i * BLOCK);
    }
    this.keystream = this.ecb.update(counters);
    this.pos = 0;
  }

  encrypt(buf) {
    const out = Buffer.allocUnsafe(buf.length);
    for (let i = 0; i < buf.length; i++) {
      if (this.pos >= this.keystream.length) this.#refill();
      out[i] = buf[i] ^ this.keystream[this.pos++];
    }
    this.hmac.update(out);
    return out;
  }

  // Пишется после данных: 10 байт кода аутентификации
  finish() {
    return this.hmac.digest().subarray(0, 10);
  }
}

module.exports = { WinZipAesEncryptor };
