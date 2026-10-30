// Шар даних: лише SQL. БД береться з контексту запиту (або з db.js, якщо контексту немає).
const { getContext } = require('../lib/context');

const getDb = () => {
  const context = getContext();
  return context && context.db ? context.db : require('../db');
};

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) =>
      err ? reject(err) : resolve(rows)
    );
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    getDb().run(sql, params, function onDone(err) {
      if (err) return reject(err);
      return resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

// Транзакції виконуються по черзі, щоб BEGIN двох запитів не перетиналися
let queue = Promise.resolve();
const transaction = (work) => {
  const result = queue.then(async () => {
    await run('BEGIN TRANSACTION');
    try {
      const value = await work();
      await run('COMMIT');
      return value;
    } catch (err) {
      await run('ROLLBACK').catch(() => {});
      throw err;
    }
  });
  queue = result.catch(() => {});
  return result;
};

module.exports = { all, get, run, transaction };
