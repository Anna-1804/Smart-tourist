const { FakeDatabase } = require('./fakeSqlite3');
const { prepareConnection, initSchema } = require('../../database');
const { runWithContext } = require('../../lib/context');

// Свіжа БД з тією самою ініціалізацією, що й на старті застосунку
async function createDb() {
  const db = new FakeDatabase();
  await prepareConnection(db);
  await initSchema(db);
  db.log.length = 0;
  return db;
}

const inRequest = (db, fn, { role = 'guest', processId = 'test0001' } = {}) =>
  runWithContext({ db, user: { role }, processId }, fn);

module.exports = { createDb, inRequest };
