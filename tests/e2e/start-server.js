const fs = require('node:fs');
const path = require('node:path');

const dbFile = path.resolve(__dirname, '../../tmp/e2e.sqlite');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  fs.rmSync(dbFile + suffix, { force: true });
}

process.env.DB_PATH = dbFile;
process.env.PORT = '3100';
require('../../index');
