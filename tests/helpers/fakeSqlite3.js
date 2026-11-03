// Імітатор API пакета sqlite3 (callback-стиль) поверх вбудованого node:sqlite.
// Потрібен лише тестам: дає змогу перевіряти справжній код шару даних без
// нативного модуля, вставляти збої (BUSY, помилка BEGIN) і рахувати запити.
const { DatabaseSync } = require('node:sqlite');

const tick = () => new Promise((resolve) => setImmediate(resolve));

// node:sqlite → помилка у форматі sqlite3: { code: 'SQLITE_...', message: 'SQLITE_...: ...' }
const toSqlite3Error = (err) => {
  const errcode = Number(err.errcode);
  let code = 'SQLITE_ERROR';
  if (errcode === 5) code = 'SQLITE_BUSY';
  else if (errcode === 6) code = 'SQLITE_LOCKED';
  else if (errcode % 256 === 19) code = 'SQLITE_CONSTRAINT';
  const wrapped = new Error(`${code}: ${err.message}`);
  wrapped.code = code;
  return wrapped;
};

class FakeDatabase {
  constructor(file = ':memory:') {
    this.raw = new DatabaseSync(file);
    this.log = []; // усі виконані SQL
    this.faults = []; // { when(sql) → bool, error, times }
  }

  // збій: наступні `times` запитів, для яких when(sql) істинне, падають з error
  inject(when, error, times = 1) {
    this.faults.push({ when, error, times });
  }

  serialize() {}

  async execute(sql, params, kind) {
    await tick();
    this.log.push(sql);
    const fault = this.faults.find((f) => f.times > 0 && f.when(sql));
    if (fault) {
      fault.times -= 1;
      throw fault.error;
    }
    try {
      if (kind === 'exec') return this.raw.exec(sql);
      const statement = this.raw.prepare(sql);
      if (kind === 'all')
        return statement.all(...params).map((r) => ({ ...r }));
      if (kind === 'get') {
        const row = statement.get(...params);
        return row ? { ...row } : undefined;
      }
      const info = statement.run(...params);
      return {
        lastID: Number(info.lastInsertRowid),
        changes: Number(info.changes),
      };
    } catch (err) {
      throw err.code && String(err.code).startsWith('SQLITE_')
        ? err
        : toSqlite3Error(err);
    }
  }

  all(sql, params, cb) {
    this.execute(sql, params, 'all').then((rows) => cb(null, rows), cb);
  }

  get(sql, params, cb) {
    this.execute(sql, params, 'get').then((row) => cb(null, row), cb);
  }

  run(sql, params, cb) {
    this.execute(sql, params, 'run').then(
      (info) => cb.call(info, null),
      (err) => cb.call({}, err)
    );
  }

  exec(sql, cb) {
    this.execute(sql, [], 'exec').then(() => cb(null), cb);
  }

  close(cb) {
    try {
      this.raw.close();
      cb(null);
    } catch (err) {
      cb(err);
    }
  }
}

module.exports = { FakeDatabase };
