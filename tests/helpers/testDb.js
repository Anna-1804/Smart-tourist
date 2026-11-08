// Обгортка над СПРАВЖНІМ sqlite3.Database для тестів. Рушій і SQL справжні;
// обгортка лише (1) веде журнал виконаних запитів (для перевірки N+1 і кількості BEGIN)
// і (2) за потреби підкидає помилку замість запиту: так відтворюються збої, які на живій
// БД не викликати передбачувано (SQLITE_BUSY на третій спробі, збій BEGIN/COMMIT/ROLLBACK).
const { openDatabase } = require('../../database');

class TestDb {
  constructor(raw) {
    this.raw = raw;
    this.log = []; // усі виконані SQL
    this.faults = []; // { when(sql) → bool, error, times }
  }

  // Відкриває справжню БД (за замовчуванням в пам'яті)
  static async open(file = ':memory:') {
    return new TestDb(await openDatabase(file));
  }

  // збій: наступні `times` запитів, для яких when(sql) істинне, падають з error
  inject(when, error, times = 1) {
    this.faults.push({ when, error, times });
  }

  takeFault(sql) {
    const fault = this.faults.find((f) => f.times > 0 && f.when(sql));
    if (!fault) return null;
    fault.times -= 1;
    return fault.error;
  }

  serialize() {
    this.raw.serialize();
  }

  close(callback) {
    this.raw.close(callback);
  }

  // API sqlite3 (callback-стиль): саме його викликають database/index.js і репозиторії
  call(method, sql, params, callback) {
    this.log.push(sql);
    const error = this.takeFault(sql);
    if (error) {
      setImmediate(() => callback.call({}, error));
      return;
    }
    this.raw[method](sql, params, callback);
  }

  all(sql, params, callback) {
    this.call('all', sql, params, callback);
  }

  get(sql, params, callback) {
    this.call('get', sql, params, callback);
  }

  run(sql, params, callback) {
    this.call('run', sql, params, callback);
  }

  exec(sql, callback) {
    this.log.push(sql);
    const error = this.takeFault(sql);
    if (error) {
      setImmediate(() => callback(error));
      return;
    }
    this.raw.exec(sql, callback);
  }

  // Promise-варіант для тестів: kind = 'exec' | 'all' | 'get' | 'run'
  execute(sql, params = [], kind = 'run') {
    return new Promise((resolve, reject) => {
      if (kind === 'exec') {
        this.exec(sql, (err) => (err ? reject(err) : resolve()));
      } else if (kind === 'run') {
        this.run(sql, params, function done(err) {
          if (err) return reject(err);
          return resolve({ lastID: this.lastID, changes: this.changes });
        });
      } else {
        this[kind](sql, params, (err, result) =>
          err ? reject(err) : resolve(result)
        );
      }
    });
  }
}

module.exports = { TestDb };
