// Міграції окремими кроками: schema → data → indexes, seed окремо.
// Це вимога CI/CD: у контейнері на старті блокує лише швидкий крок schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TestDb } = require('../helpers/testDb');
const {
  prepareConnection,
  runMigrationStep,
  initDatabase,
  closeDatabase,
  MIGRATION_STEPS,
} = require('../../database');
const { migrate } = require('../../scripts/migrate');

const freshDb = async () => {
  const db = await TestDb.open();
  await prepareConnection(db);
  return db;
};
const names = async (db, type) =>
  (
    await db.execute(
      'SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name',
      [type, 'sqlite_%'],
      'all'
    )
  ).map((row) => row.name);
const count = async (db, table) =>
  (await db.execute(`SELECT COUNT(*) AS n FROM ${table}`, [], 'get')).n;
const applied = async (db) =>
  (
    await db.execute(
      'SELECT name FROM schema_migrations ORDER BY name',
      [],
      'all'
    )
  ).map((row) => row.name);
const tmpDbFile = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migr-')), 'test.sqlite');

test('порядок кроків: schema, data, indexes, seed', () => {
  assert.deepEqual(MIGRATION_STEPS, ['schema', 'data', 'indexes', 'seed']);
});

test('крок schema: таблиці й журнал є, індексів і даних немає', async () => {
  const db = await freshDb();
  await runMigrationStep(db, 'schema');
  assert.deepEqual(await names(db, 'table'), [
    'bookings',
    'cities',
    'reviews',
    'schema_migrations',
    'tours',
  ]);
  assert.deepEqual(await names(db, 'index'), []);
  assert.equal(await count(db, 'cities'), 0);
  assert.deepEqual(await applied(db), ['schema']);
});

test('крок indexes: усі індекси створюються, повторний запуск безпечний', async () => {
  const db = await freshDb();
  await runMigrationStep(db, 'schema');
  await runMigrationStep(db, 'indexes');
  await runMigrationStep(db, 'indexes');
  assert.deepEqual(await names(db, 'index'), [
    'ix_bookings_tour',
    'ix_reviews_tour',
    'ix_tours_city',
    'ux_bookings_idempotency',
  ]);
});

test('крок seed: окремий, заповнює порожню БД і не дублює дані', async () => {
  const db = await freshDb();
  await runMigrationStep(db, 'schema');
  assert.equal(await count(db, 'tours'), 0);
  await runMigrationStep(db, 'seed');
  await runMigrationStep(db, 'seed');
  assert.equal(await count(db, 'cities'), 2);
  assert.equal(await count(db, 'tours'), 2);
});

test('крок data: дати конвертуються пачками, а не одним довгим запитом', async () => {
  const db = await freshDb();
  await runMigrationStep(db, 'schema');
  await runMigrationStep(db, 'seed');
  await db.execute(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1200)
     INSERT INTO bookings (tour_id, user_name, user_email, slots_booked, created_at)
     SELECT 1, 'u' || i, 'u@u.uu', 1, '15.10.2026' FROM n`
  );
  db.log.length = 0;

  await runMigrationStep(db, 'data', { batchSize: 500 });

  assert.equal(
    await count(db, "bookings WHERE created_at = '2026-10-15 00:00:00'"),
    1200
  );
  assert.equal(
    await count(db, "bookings WHERE created_at GLOB '[0-3][0-9].*'"),
    0
  );
  // 500 + 500 + 200 + порожня перевірка = 4 запити UPDATE для bookings
  assert.equal(
    db.log.filter((sql) => sql.includes('UPDATE bookings')).length,
    4
  );
});

test('кожен крок записується в журнал schema_migrations', async () => {
  const db = await freshDb();
  for (const name of MIGRATION_STEPS) await runMigrationStep(db, name);
  assert.deepEqual(await applied(db), ['data', 'indexes', 'schema', 'seed']);
});

test('крок data на БД без журналу: журнал створюється сам', async () => {
  const db = await freshDb();
  await runMigrationStep(db, 'schema');
  await db.execute('DROP TABLE schema_migrations', [], 'run');
  await runMigrationStep(db, 'data');
  assert.deepEqual(await applied(db), ['data']);
});

test('невідомий крок → помилка зі списком доступних', async () => {
  const db = await freshDb();
  await assert.rejects(
    runMigrationStep(db, 'drop-everything'),
    /Невідомий крок міграції "drop-everything".*schema, data, indexes, seed/
  );
});

test('prepareConnection: таймаут очікування блокування налаштовується', async () => {
  const db = await TestDb.open();
  await prepareConnection(db, { busyTimeoutMs: 7000 });
  const row = await db.execute('PRAGMA busy_timeout', [], 'get');
  assert.equal(row.timeout, 7000);
});

test('initDatabase без міграцій: порожня БД → помилка з підказкою', async () => {
  await assert.rejects(
    initDatabase(tmpDbFile(), { migrate: false }),
    /node scripts\/migrate\.js schema/
  );
});

test('initDatabase без міграцій: журнал є, але кроку schema немає → помилка', async () => {
  const file = tmpDbFile();
  const db = await TestDb.open(file);
  await db.execute(
    'CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
    [],
    'run'
  );
  await new Promise((resolve) => db.close(resolve));
  await assert.rejects(
    initDatabase(file, { migrate: false }),
    /node scripts\/migrate\.js schema/
  );
});

test('initDatabase без міграцій: після кроку schema стартує, дані не сідаються', async () => {
  const file = tmpDbFile();
  await migrate('schema', file);
  const db = await initDatabase(file, { migrate: false });
  try {
    const row = await new Promise((resolve, reject) =>
      db.get('SELECT COUNT(*) AS n FROM cities', [], (err, r) =>
        err ? reject(err) : resolve(r)
      )
    );
    assert.equal(row.n, 0);
  } finally {
    await closeDatabase();
  }
});

test('CLI migrate: усі кроки на файловій БД, повтор безпечний', async () => {
  const file = tmpDbFile();
  await migrate('all', file);
  await migrate('all', file);
  const db = await TestDb.open(file);
  assert.deepEqual(await applied(db), ['data', 'indexes', 'schema', 'seed']);
  assert.equal(await count(db, 'tours'), 2);
});

test('CLI migrate: невідомий крок падає до відкриття БД (файл не створюється)', async () => {
  const file = tmpDbFile();
  await assert.rejects(migrate('nope', file), /Невідомий крок міграції "nope"/);
  assert.equal(fs.existsSync(file), false);
});
