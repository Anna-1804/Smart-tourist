const fs = require('node:fs');
const path = require('node:path');

const dir = path.resolve(__dirname, '../../tmp');
fs.mkdirSync(dir, { recursive: true });

// Прибираємо файли старих прогонів; якщо файл зайнятий, пропускаємо: це не помилка
for (const name of fs.readdirSync(dir)) {
  if (name.startsWith('e2e')) {
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    } catch {
      // файл ще використовується попереднім процесом
    }
  }
}

// Щоразу нова база: початкові дані завжди свіжі
process.env.DB_PATH = path.join(dir, `e2e-${Date.now()}.sqlite`);
process.env.PORT = '3100';
require('../../index');
