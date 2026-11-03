// Шар даних: лише SQL, транзакції, ретраї. БД береться з контексту запиту.
const { getContext, runWithContext } = require('../lib/context');
const { ValidationError, ConflictError } = require('../lib/errors');
const logger = require('../lib/logger');

const getDb = () => {
  const context = getContext();
  if (!context || !context.db) {
    throw new Error('Репозиторій викликано поза запитом: у контексті немає БД');
  }
  return context.db;
};

// ---------- Promise-обгортки над sqlite3 ----------
const rawAll = (db, sql, params) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );
const rawGet = (db, sql, params) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  );
const rawRun = (db, sql, params) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onDone(err) {
      if (err) return reject(err);
      return resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

// ---------- Помилки БД ----------
// Обмеження БД — остання лінія валідації: замість 500 віддаємо зрозумілий 400/409.
const mapDbError = (err) => {
  if (err && err.code === 'SQLITE_CONSTRAINT') {
    const text = String(err.message);
    if (text.includes('FOREIGN KEY')) {
      return new ValidationError(
        "Пов'язаний запис (місто чи екскурсія) не існує."
      );
    }
    if (text.includes('CHECK')) {
      return new ValidationError('Значення виходить за допустимі межі.');
    }
    if (text.includes('NOT NULL')) {
      return new ValidationError("Не заповнено обов'язкове поле.");
    }
    if (text.includes('UNIQUE')) {
      return new ConflictError('Такий запис уже існує.');
    }
  }
  return err;
};

// ---------- Ретраї ----------
// Повторюємо лише тимчасові збої (SQLITE_BUSY / SQLITE_LOCKED): запит при цьому
// не виконався, тож повтор безпечний. Параметри змінюються тільки в тестах.
const config = {
  attempts: 3,
  baseDelayMs: 50,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
const TRANSIENT = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED']);

const withRetry = async (label, operation) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (!TRANSIENT.has(err.code) || attempt >= config.attempts) throw err;
      logger.warn(
        `${label}: тимчасовий збій ${err.code}, повтор ${attempt} з ${config.attempts - 1}`
      );
      await config.sleep(config.baseDelayMs * 2 ** (attempt - 1));
    }
  }
};

// ---------- Стан транзакцій окремо для кожного з'єднання ----------
const states = new WeakMap();
const stateOf = (db) => {
  if (!states.has(db)) {
    states.set(db, { queue: Promise.resolve(), active: null, dirty: false });
  }
  return states.get(db);
};

const insideTransaction = () =>
  Boolean(getContext() && getContext().transaction);

// Поки йде транзакція, запити поза нею чекають: інакше вони потрапили б
// усередину чужої транзакції на тому ж з'єднанні і зникли б при ROLLBACK.
const waitForTransaction = async (db) => {
  const state = stateOf(db);
  while (state.active) await state.active;
};

const statement =
  (label, execute) =>
  async (sql, params = []) => {
    const db = getDb();
    if (insideTransaction()) return execute(db, sql, params);
    await waitForTransaction(db);
    return withRetry(label, () => execute(db, sql, params));
  };

const all = statement('SELECT', rawAll);
const get = statement('SELECT', rawGet);
const run = statement('INSERT/UPDATE', (db, sql, params) =>
  rawRun(db, sql, params).catch((err) => {
    throw mapDbError(err);
  })
);

// ---------- Транзакції ----------
const runTransaction = async (db, context, work) => {
  const state = stateOf(db);
  let release;
  state.active = new Promise((resolve) => {
    release = resolve;
  });
  const started = Date.now();
  try {
    // Попередній ROLLBACK не вдався → з'єднання ще в транзакції: спершу закриваємо її
    if (state.dirty) {
      await rawRun(db, 'ROLLBACK', []).catch(() => {});
      state.dirty = false;
    }
    // Помилка BEGIN піднімається одразу: ні UPDATE, ні COMMIT не виконуються
    await rawRun(db, 'BEGIN IMMEDIATE', []);
    try {
      const value = await runWithContext(
        { ...context, db, transaction: true },
        work
      );
      await rawRun(db, 'COMMIT', []);
      logger.info(`транзакцію зафіксовано (${Date.now() - started} мс)`);
      return value;
    } catch (err) {
      await rawRun(db, 'ROLLBACK', []).catch((rollbackErr) => {
        state.dirty = true;
        logger.error(`ROLLBACK не вдався: ${rollbackErr.message}`);
      });
      logger.warn(`транзакцію відкочено: ${err.message}`);
      throw err;
    }
  } finally {
    state.active = null;
    release();
  }
};

// Транзакції одного з'єднання виконуються по черзі (інакше SQLite дає
// "cannot start a transaction within a transaction"). Тимчасовий збій
// повторює всю транзакцію цілком; work має бути безпечною для повтору
// (бронювання захищене ключем ідемпотентності).
const transaction = (work) => {
  const db = getDb();
  const context = getContext();
  const state = stateOf(db);
  const attempt = () => {
    const result = state.queue.then(() => runTransaction(db, context, work));
    state.queue = result.catch(() => {});
    return result;
  };
  return withRetry('транзакція', attempt);
};

module.exports = { all, get, run, transaction, withRetry, config };
