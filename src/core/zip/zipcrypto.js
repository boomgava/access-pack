'use strict';
const { randomBytes } = require('node:crypto');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// Традиционное шифрование PKWARE (APPNOTE, раздел 6.1)
class ZipCryptoEncryptor {
  constructor(password) {
    this.k0 = 0x12345678;
    this.k1 = 0x23456789;
    this.k2 = 0x34567890;
    for (const b of Buffer.from(password, 'utf8')) this.#update(b);
  }

  #update(b) {
    this.k0 = (CRC_TABLE[(this.k0 ^ b) & 0xff] ^ (this.k0 >>> 8)) >>> 0;
    this.k1 = (Math.imul((this.k1 + (this.k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    this.k2 = (CRC_TABLE[(this.k2 ^ (this.k1 >>> 24)) & 0xff] ^ (this.k2 >>> 8)) >>> 0;
  }

  #streamByte() {
    const t = (this.k2 | 2) & 0xffff;
    return (Math.imul(t, t ^ 1) >>> 8) & 0xff;
  }

  encrypt(buf) {
    const out = Buffer.allocUnsafe(buf.length);
    for (let i = 0; i < buf.length; i++) {
      const p = buf[i];
      out[i] = p ^ this.#streamByte();
      this.#update(p);
    }
    return out;
  }

  // 12 байт перед данными; последний — старший байт CRC, по нему читатель проверяет пароль
  header(crc) {
    const h = randomBytes(12);
    h[11] = (crc >>> 24) & 0xff;
    return this.encrypt(h);
  }
}

module.exports = { ZipCryptoEncryptor };
