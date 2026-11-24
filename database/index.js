// Підключення до SQLite, схема, міграції й початкові дані.
// initDatabase() викликається ЯВНО в точці старту (index.js), а не під час require:
// якщо БД недоступна, застосунок падає одразу, а не на першому запиті.
const path = require('node:path');
const { nowIso } = require('../lib/time');
const logger = require('../lib/logger');

// Окрему БД на прогін/гілку задає змінна DB_PATH (наприклад, ./tmp/feature.sqlite)
const defaultPath = () =>
  process.env.DB_PATH || path.resolve(__dirname, '..', 'database.sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT
);
CREATE TABLE IF NOT EXISTS tours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  program TEXT,
  price NUMERIC NOT NULL CHECK (price >= 0),
  available_slots INTEGER NOT NULL CHECK (available_slots >= 0),
  image_url TEXT,
  FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tour_id INTEGER,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  slots_booked INTEGER NOT NULL CHECK (slots_booked > 0),
  created_at TEXT,
  idempotency_key TEXT,
  FOREIGN KEY (tour_id) REFERENCES tours(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tour_id INTEGER,
  user_name TEXT NOT NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TEXT,
  FOREIGN KEY (tour_id) REFERENCES tours(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

// Індекси винесено в окремий крок: на великій БД їх створення триває довго
const INDEXES = `
CREATE INDEX IF NOT EXISTS ix_tours_city ON tours(city_id);
CREATE INDEX IF NOT EXISTS ix_bookings_tour ON bookings(tour_id);
CREATE INDEX IF NOT EXISTS ix_reviews_tour ON reviews(tour_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_idempotency
  ON bookings(idempotency_key);
`;

// --- Promise-обгортки, не залежні від контексту запиту (потрібні лише при старті) ---
const exec = (db, sql) =>
  new Promise((resolve, reject) =>
    db.exec(sql, (err) => (err ? reject(err) : resolve()))
  );
const run = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function onDone(err) {
      return err ? reject(err) : resolve({ changes: this.changes });
    })
  );
const get = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  );
const all = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );

function openDatabase(filePath = defaultPath()) {
  // require тут, щоб решта модулів і тести не залежали від нативного sqlite3
  const sqlite3 = require('sqlite3');
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (err) =>
      err ? reject(err) : resolve(db)
    );
  });
}

// Налаштування з'єднання + перевірка, що БД справді відповідає (падаємо одразу)
async function prepareConnection(db, { busyTimeoutMs = 5000 } = {}) {
  db.serialize(); // запити виконуються в порядку надсилання
  await exec(
    db,
    `PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${Number(busyTimeoutMs)};`
  );
  const probe = await get(db, 'SELECT 1 AS ok');
  if (!probe || probe.ok !== 1) throw new Error('БД не відповіла на SELECT 1');
}

const OLD_DATE_FORMAT = "'[0-3][0-9].[0-1][0-9].[0-9][0-9][0-9][0-9]'";

// ---------- Кроки міграцій ----------
// Кожен крок окремий і безпечний для повторного запуску.

// 1) schema: структура (блокуюча, швидка). Без неї застосунок не стартує.
async function createSchema(db) {
  await exec(db, SCHEMA);
  // ключ ідемпотентності для старих файлів БД без цього стовпця
  const columns = await all(db, 'PRAGMA table_info(bookings)');
  if (!columns.some((c) => c.name === 'idempotency_key')) {
    await exec(db, 'ALTER TABLE bookings ADD COLUMN idempotency_key TEXT');
  }
}

// 2) data: оновлення даних (неблокуюче): дати дд.мм.рррр → ISO.
// Пачками, щоб між пачками блокування записів знімалось.
async function migrateData(db, { batchSize = 500 } = {}) {
  for (const table of ['bookings', 'reviews']) {
    for (;;) {
      const { changes } = await run(
        db,
        `UPDATE ${table}
         SET created_at = substr(created_at, 7, 4) || '-' || substr(created_at, 4, 2)
                          || '-' || substr(created_at, 1, 2) || ' 00:00:00'
         WHERE id IN (
           SELECT id FROM ${table} WHERE created_at GLOB ${OLD_DATE_FORMAT} LIMIT ?
         )`,
        [batchSize]
      );
      if (changes === 0) break;
    }
  }
}

// 3) indexes: індекси (окремий крок, на великій БД довгий)
async function createIndexes(db) {
  await exec(db, INDEXES);
}

// Початкові дані записуються в одній транзакції (або всі, або жодних)
async function seedIfEmpty(db) {
  const { count } = await get(db, 'SELECT COUNT(*) AS count FROM cities');
  if (count > 0) return;

  await run(db, 'BEGIN IMMEDIATE');
  try {
    await run(
      db,
      `INSERT INTO cities (id, name, description) VALUES
       (1, 'Львів', 'Культурна столиця України.'),
       (2, 'Київ', 'Столиця України з багатою історією.')`
    );
    await run(
      db,
      `INSERT INTO tours (id, city_id, title, description, program, price, available_slots, image_url) VALUES
       (1, 1, 'Замки Львівщини', 'Екскурсія найвідомішими замками регіону.',
        '1. Виїзд зі Львова. 2. Олеський замок. 3. Підгорецький замок.', 850, 5,
        'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTcraSpYriXJGvhaLLVOJC0zv5n7xTMwhwfJMb5_uI64c9ODTUBo3CfQTk&s=10'),
       (2, 2, 'Таємниці Старого Києва', 'Пішохідна прогулянка історичним центром.',
        '1. Золоті Ворота. 2. Софійський собор. 3. Андріївський узвіз.', 500, 10,
        'https://tickikids.ams3.cdn.digitaloceanspaces.com/z1.cache/gallery/activities/9689/image_5aa55395b13a85.56890693.jpg')`
    );
    await run(
      db,
      `INSERT INTO reviews (tour_id, user_name, rating, comment, created_at)
       VALUES (1, 'Олена', 5, 'Чудова екскурсія! Гід просто супер.', ?)`,
      [nowIso()]
    );
    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }
  logger.info('База заповнена початковими даними');
}

// 4) seed: початкові дані (окремо від міграцій) — у функції seedIfEmpty вище

const STEPS = {
  schema: createSchema,
  data: migrateData,
  indexes: createIndexes,
  seed: seedIfEmpty,
};
const MIGRATION_STEPS = Object.keys(STEPS);

// Виконує один крок і записує його в журнал schema_migrations
async function runMigrationStep(db, name, options) {
  const step = STEPS[name];
  if (!step) {
    throw new Error(
      `Невідомий крок міграції "${name}". Доступні: ${MIGRATION_STEPS.join(', ')}`
    );
  }
  const started = Date.now();
  await step(db, options);
  await exec(
    db,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
  );
  await run(
    db,
    'INSERT OR REPLACE INTO schema_migrations (name, applied_at) VALUES (?, ?)',
    [name, nowIso()]
  );
  logger.info(`міграція "${name}": готово (${Date.now() - started} мс)`);
}

// Усі кроки підряд: для тестів і локальної розробки (у контейнері кроки окремі)
async function initSchema(db) {
  for (const name of MIGRATION_STEPS) {
    await runMigrationStep(db, name);
  }
}

// Без міграцій на старті: переконуємось, що крок schema уже виконано
async function assertSchemaReady(db) {
  const table = await get(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
  );
  const done =
    table &&
    (await get(db, "SELECT name FROM schema_migrations WHERE name = 'schema'"));
  if (!done) {
    throw new Error(
      'Схема БД не готова: виконайте `node scripts/migrate.js schema`'
    );
  }
}

let current = null;

// migrate: true (за замовчуванням) виконує всі кроки; false (контейнер) лише
// перевіряє, що крок schema уже виконано окремим процесом
async function initDatabase(filePath, { migrate = true } = {}) {
  const db = await openDatabase(filePath);
  try {
    await prepareConnection(db);
    if (migrate) await initSchema(db);
    else await assertSchemaReady(db);
  } catch (err) {
    await new Promise((resolve) => db.close(() => resolve()));
    throw err;
  }
  current = db;
  logger.info(`БД ініціалізовано (${filePath || defaultPath()})`);
  return db;
}

function getDatabase() {
  if (!current) {
    throw new Error(
      'БД не ініціалізована: викличте initDatabase() у точці старту'
    );
  }
  return current;
}

async function closeDatabase() {
  if (!current) return;
  const db = current;
  current = null;
  await new Promise((resolve, reject) =>
    db.close((err) => (err ? reject(err) : resolve()))
  );
}

module.exports = {
  initDatabase,
  initSchema,
  runMigrationStep,
  assertSchemaReady,
  MIGRATION_STEPS,
  prepareConnection,
  openDatabase,
  getDatabase,
  closeDatabase,
};
