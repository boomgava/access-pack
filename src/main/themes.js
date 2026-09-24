'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');

// Встроенные картинки для тем: аниме-арт с Викисклада под свободными лицензиями.
// Автор и лицензия каждой — в src/assets/themes/ATTRIBUTION.md, в настройках показывается подпись.
const MASCOTS = [
  { id: 'wikipe-tan', name: 'Wikipe-tan', file: 'wikipe-tan.png', credit: 'Kasuga, вектор Editor at Large · CC BY-SA 3.0' },
  { id: 'sorceress', name: 'Волшебница', file: 'sorceress.png', credit: 'conduit · CC BY-SA 4.0' },
  { id: 'neko', name: 'Неко', file: 'neko.png', credit: 'Kasuga · CC BY-SA 3.0' },
];

const DIR = path.join(__dirname, '..', 'assets', 'themes');

function mascots() {
  return MASCOTS.map(({ id, name, credit }) => ({ id, name, credit }));
}

// Имя приходит из настроек, поэтому читаем только из списка — никаких путей извне
async function mascotDataUrl(id) {
  const found = MASCOTS.find((m) => m.id === id);
  if (!found) return null;
  try {
    const buf = await fsp.readFile(path.join(DIR, found.file));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = { mascots, mascotDataUrl, MASCOTS };
