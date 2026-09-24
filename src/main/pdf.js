'use strict';
const path = require('node:path');
const { BrowserWindow } = require('electron');
const { buildPdfHtml } = require('../core/pdf-html');

const TEMPLATE_DIR = path.join(__dirname, '..', 'pdf');

// Одно скрытое окно на всю пачку; PDF возвращается буфером и на диск не пишется.
class PdfRenderer {

  async init() {
    this.win = new BrowserWindow({
      show: false,
      width: 794,
      height: 1123,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await this.win.loadFile(path.join(TEMPLATE_DIR, 'template.html'));
  }

  // Готовая разметка → PDF; поля страницы задаёт @page в CSS шаблона
  async renderHtml(html) {
    await this.win.webContents.executeJavaScript(`window.setDoc(${JSON.stringify(html)})`);
    return this.win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  }

  async render(data) {
    return this.renderHtml(buildPdfHtml(data));
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

module.exports = { PdfRenderer };
