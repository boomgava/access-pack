'use strict';

// .rdp — текст «ключ:тип:значение» построчно. mstsc сохраняет его в UTF-16 LE с BOM;
// кодировку и переводы строк сохраняем, иначе mstsc может не открыть файл.
function decode(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { enc: 'utf16le', bom: true, text: buf.subarray(2).toString('utf16le') };
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { enc: 'utf8', bom: true, text: buf.subarray(3).toString('utf8') };
  }
  return { enc: 'utf8', bom: false, text: buf.toString('utf8') };
}

function encode({ enc, bom }, text) {
  const body = Buffer.from(text, enc);
  if (!bom) return body;
  const mark = enc === 'utf16le' ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xef, 0xbb, 0xbf]);
  return Buffer.concat([mark, body]);
}

function setRdpUsername(buf, username) {
  const src = decode(buf);
  const eol = src.text.includes('\n') && !src.text.includes('\r\n') ? '\n' : '\r\n';
  const line = `username:s:${username}`;
  const lines = src.text.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^username:s:/i.test(l.trim()));
  if (idx >= 0) {
    lines[idx] = line;
  } else {
    let at = lines.length;
    while (at > 0 && lines[at - 1] === '') at--;
    lines.splice(at, 0, line);
    if (lines[lines.length - 1] !== '') lines.push('');
  }
  return encode(src, lines.join(eol));
}

module.exports = { setRdpUsername };
