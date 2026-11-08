const { TestDb } = require('./testDb');
const { prepareConnection, initSchema } = require('../../database');
const { runWithContext } = require('../../lib/context');

// Свіжа БД з тією самою ініціалізацією, що й на старті застосунку
async function createDb() {
  const db = await TestDb.open();
  await prepareConnection(db);
  await initSchema(db);
  db.log.length = 0;
  return db;
}

const inRequest = (db, fn, { role = 'guest', processId = 'test0001' } = {}) =>
  runWithContext({ db, user: { role }, processId }, fn);

module.exports = { createDb, inRequest };
