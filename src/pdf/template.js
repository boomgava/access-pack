'use strict';

// Вызывается из main через executeJavaScript: вставить тело и дождаться шрифтов и логотипа
window.setDoc = async function setDoc(html) {
  document.getElementById('doc').innerHTML = html;
  const sample = 'Aa Яя 0123';
  await Promise.all(
    ['400 12px Inter', '600 12px Inter', '700 12px Inter', '500 12px "JetBrains Mono"'].map((f) =>
      document.fonts.load(f, sample),
    ),
  );
  await document.fonts.ready;
  await Promise.all(Array.from(document.images, (img) => (img.complete ? null : img.decode().catch(() => null))));
  return true;
};
