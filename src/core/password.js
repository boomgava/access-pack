'use strict';
const { randomInt } = require('node:crypto');

// Без похожих символов I O l o 0 1 — пароль диктуют по телефону
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function generateArchivePassword() {
  const groups = [];
  for (let g = 0; g < 3; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join('-');
}

module.exports = { generateArchivePassword, ALPHABET };
