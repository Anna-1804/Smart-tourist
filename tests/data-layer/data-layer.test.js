const test = require('node:test');
const assert = require('node:assert/strict');
const { TestDb } = require('../helpers/testDb');
const { createDb, inRequest } = require('../helpers/env');
const { prepareConnection, initSchema } = require('../../database');
const base = require('../../repositories/base');
const bookingRepo = require('../../repositories/bookingRepository');
const tourRepo = require('../../repositories/tourRepository');
const reviewRepo = require('../../repositories/reviewRepository');
const bookingService = require('../../services/bookingService');
const tourService = require('../../services/tourService');
const adminService = require('../../services/adminService');
const logger = require('../../lib/logger');
const { ValidationError, ConflictError } = require('../../lib/errors');

const form = (o = {}) => ({
  user_name: 'Оля',
  user_email: 'olya@example.com',
  slots_booked: '1',
  ...o,
});
const slotsOf = async (db, id) =>
  (
    await db.execute(
      'SELECT available_slots AS n FROM tours WHERE id = ?',
      [id],
      'get'
    )
  ).n;
const countRows = async (db, table) =>
  (await db.execute(`SELECT COUNT(*) AS n FROM ${table}`, [], 'get')).n;
const busy = () =>
  Object.assign(new Error('SQLITE_BUSY: database is locked'), {
    code: 'SQLITE_BUSY',
  });
const isBegin = (sql) => sql === 'BEGIN IMMEDIATE';

// паузи ретраїв у тестах не чекаємо
const delays = [];
base.config.sleep = async (ms) => {
  delays.push(ms);
};
test.beforeEach(() => {
  delays.length = 0;
});

// ---------------------------------------------------------------- ініціалізація
test('старт: схема створюється, початкові дані записані, дати ISO', async () => {
  const db = await createDb();
  assert.equal(await countRows(db, 'tours'), 2);
  const review = await db.execute(
    'SELECT created_at, datetime(created_at) AS d FROM reviews',
    [],
    'get'
  );
  assert.match(review.created_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  assert.equal(review.d, review.created_at);
});

test('старт: недоступна БД → помилка одразу (SELECT 1)', async () => {
  const db = await TestDb.open();
  db.inject((sql) => sql === 'SELECT 1 AS ok', new Error('SQLITE_CANTOPEN'));
  await assert.rejects(prepareConnection(db), /SQLITE_CANTOPEN/);
});

test('міграція: старий файл БД отримує ключ ідемпотентності й ISO-дати', async () => {
  const db = await TestDb.open();
  await db.execute(
    `CREATE TABLE cities (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT);
     CREATE TABLE tours (id INTEGER PRIMARY KEY AUTOINCREMENT, city_id INTEGER, title TEXT NOT NULL,
       description TEXT, program TEXT, price NUMERIC NOT NULL, available_slots INTEGER NOT NULL, image_url TEXT);
     CREATE TABLE bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, tour_id INTEGER, user_name TEXT NOT NULL,
       user_email TEXT NOT NULL, slots_booked INTEGER NOT NULL, created_at TEXT);
     CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, tour_id INTEGER, user_name TEXT NOT NULL,
       rating INTEGER, comment TEXT, created_at TEXT);
     INSERT INTO cities VALUES (1,'Львів','x');
     INSERT INTO tours VALUES (1,1,'T',NULL,NULL,10,3,NULL);
     INSERT INTO bookings VALUES (1,1,'a','a@a.aa',1,'15.10.2026'),(2,1,'b','b@b.bb',1,'22.10.2026');
     INSERT INTO reviews VALUES (1,1,'o',5,'c','2026-10-14 14:18:30');`,
    [],
    'exec'
  );
  await prepareConnection(db);
  await initSchema(db);
  const rows = await db.execute(
    'SELECT id, created_at FROM bookings ORDER BY datetime(created_at) DESC',
    [],
    'all'
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    [2, 1]
  );
  assert.equal(rows[0].created_at, '2026-10-22 00:00:00');
  const cols = await db.execute('PRAGMA table_info(bookings)', [], 'all');
  assert.ok(cols.some((c) => c.name === 'idempotency_key'));
});

// ---------------------------------------------------------------- транзакції
test('паралельні бронювання: 10 запитів на 5 місць → рівно 5 успішних, без падіння', async () => {
  const db = await createDb();
  const results = await inRequest(db, () =>
    Promise.allSettled(
      Array.from({ length: 10 }, () => bookingService.createBooking(1, form()))
    )
  );
  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 5);
  assert.ok(failed.every((r) => r.reason instanceof ConflictError));
  assert.match(failed[0].reason.message, /доступно лише 0/);
  assert.equal(await slotsOf(db, 1), 0);
  assert.equal(await countRows(db, 'bookings'), 5);
});

test('бронювання більше, ніж є місць: { booked: false }, БД не змінюється', async () => {
  const db = await createDb();
  const r = await inRequest(db, () =>
    bookingRepo.create({
      tourId: 1,
      userName: 'a',
      userEmail: 'a@a.aa',
      slots: 6,
    })
  );
  assert.deepEqual(r, { booked: false });
  assert.equal(await slotsOf(db, 1), 5);
});

test('помилка всередині транзакції → ROLLBACK, зміни зникають', async () => {
  const db = await createDb();
  await assert.rejects(
    inRequest(db, () =>
      base.transaction(async () => {
        await base.run('UPDATE tours SET available_slots = 0 WHERE id = 1');
        throw new Error('збій після UPDATE');
      })
    ),
    /збій після UPDATE/
  );
  assert.equal(await slotsOf(db, 1), 5);
});

test('запис поза транзакцією не потрапляє всередину чужої і не зникає при ROLLBACK', async () => {
  const db = await createDb();
  let releaseTx;
  const txHold = new Promise((resolve) => {
    releaseTx = resolve;
  });
  const failingTx = inRequest(db, () =>
    base.transaction(async () => {
      await base.run('UPDATE tours SET available_slots = 1 WHERE id = 2');
      await txHold;
      throw new Error('відкат');
    })
  );
  await new Promise((resolve) => setImmediate(resolve));
  // відгук від іншого запиту надходить, поки транзакція відкрита
  const review = inRequest(db, () =>
    reviewRepo.insert({
      tourId: 2,
      userName: 'Інший',
      rating: 5,
      comment: 'ok',
    })
  );
  await new Promise((resolve) => setImmediate(resolve));
  releaseTx();
  await assert.rejects(failingTx, /відкат/);
  await review;
  assert.equal(await slotsOf(db, 2), 10); // відкочено
  assert.equal(await countRows(db, 'reviews'), 2); // відгук іншого запиту збережено
});

test('помилка BEGIN: UPDATE/COMMIT/ROLLBACK не виконуються, наступна транзакція працює', async () => {
  const db = await createDb();
  db.inject(
    isBegin,
    Object.assign(new Error('SQLITE_ERROR: disk'), { code: 'SQLITE_ERROR' })
  );
  await assert.rejects(
    inRequest(db, () =>
      bookingRepo.create({
        tourId: 1,
        userName: 'a',
        userEmail: 'a@a.aa',
        slots: 1,
      })
    ),
    /disk/
  );
  assert.deepEqual(
    db.log.filter((s) => /UPDATE|COMMIT|ROLLBACK|INSERT/.test(s)),
    []
  );
  const ok = await inRequest(db, () =>
    bookingRepo.create({
      tourId: 1,
      userName: 'a',
      userEmail: 'a@a.aa',
      slots: 1,
    })
  );
  assert.equal(ok.booked, true);
});

test('ROLLBACK, що не вдався, не маскує початкову помилку', async () => {
  const db = await createDb();
  db.inject((sql) => sql === 'ROLLBACK', new Error('SQLITE_IOERR: rollback'));
  await assert.rejects(
    inRequest(db, () =>
      base.transaction(async () => {
        throw new Error('головна помилка');
      })
    ),
    /головна помилка/
  );
  // і наступна транзакція не заблокована
  await inRequest(db, () => base.transaction(async () => 1));
});

// ---------------------------------------------------------------- ретраї
test('ретраї: BEGIN двічі BUSY, на третій спробі успіх; паузи ростуть', async () => {
  const db = await createDb();
  db.inject(isBegin, busy(), 2);
  const r = await inRequest(db, () =>
    bookingRepo.create({
      tourId: 1,
      userName: 'a',
      userEmail: 'a@a.aa',
      slots: 1,
    })
  );
  assert.equal(r.booked, true);
  assert.deepEqual(delays, [50, 100]);
  assert.equal(await slotsOf(db, 1), 4); // списано один раз, не тричі
});

test('ретраї: після вичерпання спроб піднімається SQLITE_BUSY', async () => {
  const db = await createDb();
  db.inject(isBegin, busy(), 10);
  await assert.rejects(
    inRequest(db, () =>
      bookingRepo.create({
        tourId: 1,
        userName: 'a',
        userEmail: 'a@a.aa',
        slots: 1,
      })
    ),
    (err) => err.code === 'SQLITE_BUSY'
  );
  assert.equal(db.log.filter(isBegin).length, 3);
});

test('ретраї: нетимчасова помилка не повторюється', async () => {
  const db = await createDb();
  db.inject(
    isBegin,
    Object.assign(new Error('SQLITE_ERROR'), { code: 'SQLITE_ERROR' }),
    10
  );
  await assert.rejects(inRequest(db, () => base.transaction(async () => 1)));
  assert.equal(db.log.filter(isBegin).length, 1);
  assert.deepEqual(delays, []);
});

test('ретраї: BUSY при читанні поза транзакцією повторюється, значення повертається', async () => {
  const db = await createDb();
  db.inject((sql) => sql.startsWith('SELECT * FROM tours'), busy(), 1);
  const tours = await inRequest(db, () => tourRepo.listTours(null));
  assert.equal(tours.length, 2);
});

test('ретраї: збій COMMIT (BUSY) відкочує і повторює всю транзакцію без подвійного списання', async () => {
  const db = await createDb();
  db.inject((sql) => sql === 'COMMIT', busy(), 1);
  const r = await inRequest(db, () =>
    bookingRepo.create({
      tourId: 1,
      userName: 'a',
      userEmail: 'a@a.aa',
      slots: 2,
    })
  );
  assert.equal(r.booked, true);
  assert.equal(await slotsOf(db, 1), 3);
  assert.equal(await countRows(db, 'bookings'), 1);
});

// ---------------------------------------------------------------- ідемпотентність
test('той самий ключ двічі → одне бронювання, місця списані один раз', async () => {
  const db = await createDb();
  const body = form({ slots_booked: '3', idempotency_key: 'key-12345678' });
  const first = await inRequest(db, () =>
    bookingService.createBooking(2, body)
  );
  const again = await inRequest(db, () =>
    bookingService.createBooking(2, body)
  );
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.id, first.id);
  assert.equal(await slotsOf(db, 2), 7);
  assert.equal(await countRows(db, 'bookings'), 1);
});

test('повтор форми після бронювання останніх місць — «вже оформлено», а не 409', async () => {
  const db = await createDb();
  const body = form({ slots_booked: '5', idempotency_key: 'key-last-slots' });
  await inRequest(db, () => bookingService.createBooking(1, body));
  const again = await inRequest(db, () =>
    bookingService.createBooking(1, body)
  );
  assert.equal(again.duplicate, true);
  assert.equal(await slotsOf(db, 1), 0);
});

test('без ключа (або з некоректним) повтор — нове бронювання, як і раніше', async () => {
  const db = await createDb();
  await inRequest(db, () => bookingService.createBooking(2, form()));
  await inRequest(db, () =>
    bookingService.createBooking(2, form({ idempotency_key: 'x' }))
  );
  assert.equal(await countRows(db, 'bookings'), 2);
});

test('паралельні повтори одного ключа: створюється рівно одне бронювання', async () => {
  const db = await createDb();
  const body = form({ idempotency_key: 'key-parallel-1' });
  await inRequest(db, () =>
    Promise.all(
      Array.from({ length: 6 }, () => bookingService.createBooking(2, body))
    )
  );
  assert.equal(await countRows(db, 'bookings'), 1);
  assert.equal(await slotsOf(db, 2), 9);
});

// ---------------------------------------------------------------- збої джерела
test('збій БД не ховається порожнім списком: репозиторій відхиляє проміс', async () => {
  const db = await createDb();
  db.inject(
    (sql) => sql.startsWith('SELECT * FROM tours'),
    Object.assign(new Error('SQLITE_IOERR: disk I/O'), {
      code: 'SQLITE_IOERR',
    }),
    5
  );
  await assert.rejects(
    inRequest(db, () => tourRepo.listTours(null)),
    /disk I\/O/
  );
});

test('закрита БД: усі операції відхиляються', async () => {
  const db = await createDb();
  await new Promise((resolve) => db.close(resolve));
  await assert.rejects(inRequest(db, () => adminService.getDashboard()));
  await assert.rejects(
    inRequest(db, () => bookingService.createBooking(1, form()))
  );
});

test('виклик репозиторію поза запитом дає зрозумілу помилку', async () => {
  await assert.rejects(() => tourRepo.listTours(null), /поза запитом/);
});

test('обмеження БД перетворюються на 400, а не 500', async () => {
  const db = await createDb();
  const badCity = inRequest(db, () =>
    tourRepo.insertTour({
      cityId: 999,
      title: 'T',
      description: '',
      program: '',
      price: 1,
      availableSlots: 1,
      imageUrl: 'u',
    })
  );
  await assert.rejects(
    badCity,
    (e) => e instanceof ValidationError && e.status === 400
  );
  const negative = inRequest(db, () =>
    tourRepo.insertTour({
      cityId: 1,
      title: 'T',
      description: '',
      program: '',
      price: -5,
      availableSlots: 1,
      imageUrl: 'u',
    })
  );
  await assert.rejects(
    negative,
    (e) => e instanceof ValidationError && /межі/.test(e.message)
  );
});

test('валідація сервісів: дробові місця й порожня ціна відхиляються', async () => {
  const db = await createDb();
  const bad = (fn) => assert.rejects(inRequest(db, fn), ValidationError);
  await bad(() =>
    bookingService.createBooking(1, form({ slots_booked: '1.5' }))
  );
  await bad(() =>
    tourService.createTour({
      city_id: '1',
      title: 'T',
      price: '',
      available_slots: '3',
    })
  );
  assert.equal(await slotsOf(db, 1), 5);
});

// ---------------------------------------------------------------- дати
test('нові записи мають ISO-дату і сортуються від найновіших', async () => {
  const db = await createDb();
  await inRequest(db, () =>
    bookingService.createBooking(2, form({ user_name: 'Перша' }))
  );
  await inRequest(db, () =>
    bookingService.createBooking(2, form({ user_name: 'Друга' }))
  );
  const list = await inRequest(db, () => bookingRepo.list(null));
  assert.match(list[0].created_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  assert.deepEqual(
    list.map((b) => b.user_name),
    ['Друга', 'Перша']
  );
});

// ---------------------------------------------------------------- контекст і лог
test('ID процесу є в кожному лозі: сервіс → репозиторій → транзакція', async () => {
  const db = await createDb();
  const lines = [];
  const restore = logger.setSink((_, line) => lines.push(line));
  try {
    await inRequest(db, () => bookingService.createBooking(2, form()), {
      processId: 'abc12345',
    });
  } finally {
    restore();
  }
  assert.ok(lines.length >= 2);
  assert.ok(lines.every((l) => l.includes('[process=abc12345]')));
  assert.ok(lines.some((l) => l.includes('транзакцію зафіксовано')));
  assert.ok(lines.some((l) => l.includes('бронювання')));
});

test('паралельні запити не змішують ID процесів у логах', async () => {
  const db = await createDb();
  const lines = [];
  const restore = logger.setSink((_, line) => lines.push(line));
  try {
    await Promise.all(
      ['aaaa1111', 'bbbb2222', 'cccc3333'].map((id) =>
        inRequest(db, () => bookingService.createBooking(2, form()), {
          processId: id,
        })
      )
    );
  } finally {
    restore();
  }
  for (const id of ['aaaa1111', 'bbbb2222', 'cccc3333']) {
    const own = lines.filter((l) => l.includes(`[process=${id}]`));
    assert.ok(
      own.some((l) => l.includes('транзакцію зафіксовано')),
      id
    );
  }
  assert.equal(lines.filter((l) => l.includes('[process=-]')).length, 0);
});

// ---------------------------------------------------------------- N+1
test('N+1: кількість запитів не залежить від кількості турів, бронювань і відгуків', async () => {
  const countFor = async (tours) => {
    const db = await createDb();
    for (let i = 3; i <= tours; i += 1) {
      await db.execute(
        'INSERT INTO tours (city_id, title, price, available_slots) VALUES (?, ?, 1, 100)',
        [(i % 2) + 1, `T${i}`],
        'run'
      );
      await db.execute(
        "INSERT INTO bookings (tour_id, user_name, user_email, slots_booked, created_at) VALUES (?, 'u', 'u@e.ee', 1, '2026-10-30 10:00:00')",
        [i],
        'run'
      );
      await db.execute(
        "INSERT INTO reviews (tour_id, user_name, rating, comment, created_at) VALUES (?, 'u', 5, 'c', '2026-10-30 10:00:00')",
        [i],
        'run'
      );
    }
    const measure = async (fn) => {
      db.log.length = 0;
      await inRequest(db, fn, { role: 'admin' });
      return db.log.length;
    };
    return {
      dashboard: await measure(() => adminService.getDashboard()),
      details: await measure(() => tourService.getTourDetails(1)),
      catalog: await measure(() =>
        Promise.all([tourService.listCities(), tourService.listTours(null)])
      ),
    };
  };
  assert.deepEqual(await countFor(2), await countFor(60));
});
