// Інтеграційні тести: піднімаються справжній HTTP-сервер (Express на вільному порту)
// і справжня ініціалізація БД (database/index.js: схема, міграції, початкові дані).
// Запити йдуть через мережу (fetch), тож перевіряється весь ланцюжок:
// маршрут → сервіс → репозиторій → SQLite → шаблон EJS → відповідь.
process.env.NODE_ENV = 'test';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const logger = require('../../lib/logger');

const app = require('../../index');
const { initDatabase, closeDatabase, getDatabase } = require('../../database');

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

// кожен тест починається з чистої БД з початковими даними
beforeEach(async () => {
  await closeDatabase();
  await initDatabase(':memory:');
});

// ---------- допоміжні функції ----------
const request = async (method, path, { form, role } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(role ? { 'x-user-role': role } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
    redirect: 'manual',
  });
  return { status: res.status, headers: res.headers, body: await res.text() };
};

const get = (path, role) => request('GET', path, { role });
const post = (path, form, role) => request('POST', path, { form, role });

const slotsOf = async (tourId) => {
  const { body } = await get(`/tours/${tourId}`);
  return Number(body.match(/Вільних місць:[^>]*>\s*(\d+)/)[1]);
};

const booking = (extra = {}) => ({
  user_name: 'Олена',
  user_email: 'elena@gmail.com',
  slots_booked: '1',
  idempotency_key: `key-${Math.random().toString(36).slice(2)}-0001`,
  ...extra,
});

const dbAll = (sql) =>
  new Promise((resolve, reject) =>
    getDatabase().all(sql, [], (err, rows) =>
      err ? reject(err) : resolve(rows)
    )
  );

const dbExec = (sql) =>
  new Promise((resolve, reject) =>
    getDatabase().exec(sql, (err) => (err ? reject(err) : resolve()))
  );

// ---------- сценарії користувача ----------
describe('Сценарій 1.1: вибір міста та перегляд екскурсій', () => {
  test('GET / → 200, показує обидві екскурсії', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.match(res.body, /Замки Львівщини/);
    assert.match(res.body, /Таємниці Старого Києва/);
  });

  test('GET /?city_id=2 → лише екскурсії Києва', async () => {
    const res = await get('/?city_id=2');
    assert.equal(res.status, 200);
    assert.match(res.body, /Таємниці Старого Києва/);
    assert.doesNotMatch(res.body, /Замки Львівщини/);
  });

  // id турів збігаються з id міст у початкових даних, тож додаємо тур,
  // де вони різні: фільтр має працювати за city_id, а не за id туру
  test('фільтр за містом працює за city_id (тур №3 у Львові)', async () => {
    await post(
      '/admin/tours',
      {
        city_id: '1',
        title: 'Нічний Львів',
        price: '400',
        available_slots: '8',
      },
      'admin'
    );
    const lviv = (await get('/?city_id=1')).body;
    assert.match(lviv, /Замки Львівщини/);
    assert.match(lviv, /Нічний Львів/);
    assert.doesNotMatch(lviv, /Таємниці Старого Києва/);

    const kyiv = (await get('/?city_id=2')).body;
    assert.doesNotMatch(kyiv, /Нічний Львів/);
  });
});

describe('Сценарій 1.2: перегляд опису екскурсії', () => {
  test('GET /tours/1 → 200 з містом, програмою і відгуками', async () => {
    const res = await get('/tours/1');
    assert.equal(res.status, 200);
    assert.match(res.body, /Замки Львівщини \(Львів\)/);
    assert.match(res.body, /Олеський замок/);
    assert.match(res.body, /Чудова екскурсія/);
  });

  test('відгуки: спершу найновіші (за датою, а не за id)', async () => {
    await dbExec(
      `INSERT INTO reviews (tour_id, user_name, rating, comment, created_at) VALUES
       (1, 'А', 5, 'ВІДГУК-НОВИЙ', '2026-03-01 10:00:00'),
       (1, 'Б', 5, 'ВІДГУК-СТАРИЙ', '2026-01-01 10:00:00')`
    );
    const { body } = await get('/tours/1');
    assert.ok(
      body.indexOf('ВІДГУК-НОВИЙ') < body.indexOf('ВІДГУК-СТАРИЙ'),
      'новіший відгук має бути вище'
    );
  });

  test('GET /tours/9999 → 404', async () => {
    const res = await get('/tours/9999');
    assert.equal(res.status, 404);
    assert.match(res.body, /404 Not Found/);
  });

  test('GET /tours/abc → 404 (id не число)', async () => {
    assert.equal((await get('/tours/abc')).status, 404);
  });
});

describe('Сценарій 1.3: бронювання місць', () => {
  test('успіх: 200, місця зменшились, запис у bookings з ISO-датою', async () => {
    const before = await slotsOf(1);
    const res = await post('/tours/1/book', booking({ slots_booked: '2' }));
    assert.equal(res.status, 200);
    assert.match(res.body, /Місця успішно заброньовані/);
    assert.equal(await slotsOf(1), before - 2);

    const rows = await dbAll('SELECT * FROM bookings');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].slots_booked, 2);
    assert.match(rows[0].created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('більше, ніж є місць → 409, БД не змінюється', async () => {
    const before = await slotsOf(1);
    const res = await post('/tours/1/book', booking({ slots_booked: '999' }));
    assert.equal(res.status, 409);
    assert.match(res.body, /доступно лише/);
    // сторінка туру з формою лишається (а не загальна сторінка помилки)
    assert.match(res.body, /name="slots_booked"/);
    assert.equal(await slotsOf(1), before);
    assert.equal((await dbAll('SELECT * FROM bookings')).length, 0);
  });

  test('бронювання рівно на всі місця дозволене, наступне → 409', async () => {
    const all = await slotsOf(1);
    const full = await post(
      '/tours/1/book',
      booking({ slots_booked: String(all) })
    );
    assert.equal(full.status, 200);
    assert.equal(await slotsOf(1), 0);
    assert.equal((await post('/tours/1/book', booking())).status, 409);
  });

  const invalid = [
    ['порожнє імʼя', { user_name: '' }],
    ['email без @', { user_email: 'bad' }],
    ['нуль місць', { slots_booked: '0' }],
    ['дробова кількість', { slots_booked: '1.5' }],
    ['не число', { slots_booked: 'abc' }],
  ];
  for (const [title, fields] of invalid) {
    test(`некоректні дані (${title}) → 400, БД не змінюється`, async () => {
      const before = await slotsOf(1);
      const res = await post('/tours/1/book', booking(fields));
      assert.equal(res.status, 400);
      assert.equal(await slotsOf(1), before);
      assert.equal((await dbAll('SELECT * FROM bookings')).length, 0);
    });
  }

  test('неіснуючий тур → 404', async () => {
    assert.equal((await post('/tours/999/book', booking())).status, 404);
  });

  test('повторне надсилання форми з тим самим ключем списує місця один раз', async () => {
    const before = await slotsOf(1);
    const form = booking();
    const first = await post('/tours/1/book', form);
    const second = await post('/tours/1/book', form);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.match(second.body, /вже було оформлено раніше/);
    assert.equal(await slotsOf(1), before - 1);
    assert.equal((await dbAll('SELECT * FROM bookings')).length, 1);
  });

  test('паралельні бронювання: успішних рівно стільки, скільки місць, без 500', async () => {
    const seats = await slotsOf(1);
    const results = await Promise.all(
      Array.from({ length: seats + 4 }, () => post('/tours/1/book', booking()))
    );
    const count = (code) => results.filter((r) => r.status === code).length;
    assert.equal(count(200), seats);
    assert.equal(count(409), 4);
    assert.equal(count(500), 0);
    assert.equal(await slotsOf(1), 0);
    assert.equal((await dbAll('SELECT * FROM bookings')).length, seats);
  });

  test('паралельні повтори одного ключа створюють одне бронювання', async () => {
    const form = booking();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post('/tours/1/book', form))
    );
    assert.ok(results.every((r) => r.status === 200));
    assert.equal((await dbAll('SELECT * FROM bookings')).length, 1);
  });
});

describe('Сценарій 1.4: залишення відгуку', () => {
  test('успіх → 200, відгук видно на сторінці туру', async () => {
    const res = await post('/tours/2/reviews', {
      user_name: 'Марко',
      rating: '1',
      comment: 'Занадто довго',
    });
    assert.equal(res.status, 200);
    assert.match(res.body, /Дякуємо/);
    assert.match((await get('/tours/2')).body, /Занадто довго/);
  });

  for (const rating of ['0', '6', '3.5']) {
    test(`оцінка ${rating} поза шкалою 1–5 → 400`, async () => {
      const res = await post('/tours/2/reviews', {
        user_name: 'Марко',
        rating,
        comment: 'x',
      });
      assert.equal(res.status, 400);
      const rows = await dbAll('SELECT * FROM reviews WHERE tour_id = 2');
      assert.equal(rows.length, 0);
    });
  }

  test('порожній коментар → 400', async () => {
    const res = await post('/tours/2/reviews', {
      user_name: 'Марко',
      rating: '5',
      comment: '',
    });
    assert.equal(res.status, 400);
  });

  test('неіснуючий тур → 404', async () => {
    const res = await post('/tours/999/reviews', {
      user_name: 'Марко',
      rating: '5',
      comment: 'x',
    });
    assert.equal(res.status, 404);
  });
});

// ---------- сценарії адміністратора ----------
describe('Права доступу', () => {
  const protectedRoutes = [
    ['GET', '/admin'],
    ['POST', '/admin/tours'],
    ['POST', '/admin/tours/1/update'],
  ];
  const formFor = (method) => (method === 'POST' ? { title: 'x' } : undefined);
  for (const [method, path] of protectedRoutes) {
    test(`${method} ${path} без ролі → 403`, async () => {
      const res = await request(method, path, { form: formFor(method) });
      assert.equal(res.status, 403);
    });

    test(`${method} ${path} з роллю guest → 403`, async () => {
      const res = await request(method, path, {
        form: formFor(method),
        role: 'guest',
      });
      assert.equal(res.status, 403);
    });
  }

  test('роль можна передати і параметром ?role=admin', async () => {
    assert.equal((await get('/admin?role=admin')).status, 200);
  });
});

describe('Сценарій 2.1: додавання екскурсії', () => {
  const tour = {
    city_id: '1',
    title: 'Нічний Львів',
    price: '400',
    available_slots: '8',
    description: 'Вечірня прогулянка',
    program: '1. Ратуша',
  };

  test('успіх → 200, тур зʼявляється в каталозі', async () => {
    const res = await post('/admin/tours', tour, 'admin');
    assert.equal(res.status, 200);
    assert.match(res.body, /Нову екскурсію успішно додано/);
    assert.match((await get('/')).body, /Нічний Львів/);
  });

  test('без фото підставляється зображення за замовчуванням', async () => {
    await post('/admin/tours', tour, 'admin');
    const [row] = await dbAll(
      "SELECT image_url FROM tours WHERE title = 'Нічний Львів'"
    );
    assert.match(row.image_url, /^https:\/\/images\.unsplash\.com/);
  });

  test("від'ємна ціна → 400, тур не додається", async () => {
    const res = await post('/admin/tours', { ...tour, price: '-1' }, 'admin');
    assert.equal(res.status, 400);
    assert.equal((await dbAll('SELECT * FROM tours')).length, 2);
  });

  test('порожня назва → 400', async () => {
    const res = await post('/admin/tours', { ...tour, title: '' }, 'admin');
    assert.equal(res.status, 400);
  });

  test('неіснуюче місто → 400 (обмеження БД, не 500)', async () => {
    const res = await post(
      '/admin/tours',
      { ...tour, city_id: '999' },
      'admin'
    );
    assert.equal(res.status, 400);
    assert.equal((await dbAll('SELECT * FROM tours')).length, 2);
  });
});

describe('Сценарій 2.2: зміна екскурсії', () => {
  test('усі поля оновлюються й видні на сторінці туру', async () => {
    const res = await post(
      '/admin/tours/1/update',
      {
        title: 'Замки (оновлено)',
        price: '999',
        available_slots: '3',
        description: 'Новий опис',
        program: 'Нова програма',
        image_url: 'https://example.com/new.jpg',
      },
      'admin'
    );
    assert.equal(res.status, 200);
    assert.match(res.body, /Параметри екскурсії оновлено/);
    const page = (await get('/tours/1')).body;
    assert.match(page, /Замки \(оновлено\)/);
    assert.match(page, /Новий опис/);
    assert.match(page, /Нова програма/);
    assert.equal(await slotsOf(1), 3);
  });

  test('передані не всі поля: решта лишається', async () => {
    await post('/admin/tours/1/update', { price: '777' }, 'admin');
    const [row] = await dbAll('SELECT * FROM tours WHERE id = 1');
    assert.equal(row.price, 777);
    assert.equal(row.title, 'Замки Львівщини');
  });

  test('неіснуючий тур → 404', async () => {
    const res = await post('/admin/tours/999/update', { price: '1' }, 'admin');
    assert.equal(res.status, 404);
  });

  test("від'ємні місця → 400, дані не змінюються", async () => {
    const res = await post(
      '/admin/tours/1/update',
      { available_slots: '-1' },
      'admin'
    );
    assert.equal(res.status, 400);
    assert.equal(await slotsOf(1), 5);
  });
});

describe('Сценарії 2.3 і 2.4: відгуки й бронювання в адмінці', () => {
  beforeEach(async () => {
    await post('/tours/1/book', booking({ user_name: 'Іван-Львів' }));
    await post('/tours/2/book', booking({ user_name: 'Петро-Київ' }));
  });

  test('без фільтра: бронювання обох турів і відгуки', async () => {
    const res = await get('/admin', 'admin');
    assert.equal(res.status, 200);
    assert.match(res.body, /Іван-Львів/);
    assert.match(res.body, /Петро-Київ/);
    assert.match(res.body, /Чудова екскурсія/);
  });

  test('tour_id=1: бронювання лише цього туру', async () => {
    const res = await get('/admin?tour_id=1', 'admin');
    assert.equal(res.status, 200);
    assert.match(res.body, /Іван-Львів/);
    assert.doesNotMatch(res.body, /Петро-Київ/);
  });

  test('tour_id=2: відгуки першого туру не показуються', async () => {
    const res = await get('/admin?tour_id=2', 'admin');
    assert.doesNotMatch(res.body, /Чудова екскурсія/);
  });

  for (const bad of ['abc', '0', '-1', '1.5']) {
    test(`tour_id=${bad} → 400`, async () => {
      assert.equal((await get(`/admin?tour_id=${bad}`, 'admin')).status, 400);
    });
  }
});

// ---------- наскрізні властивості ----------
describe('Сценарії помилок і ідентифікатор процесу', () => {
  test('неіснуюча сторінка → 404', async () => {
    assert.equal((await get('/nothing-here')).status, 404);
  });

  test('X-Process-Id є у кожній відповіді, ID різні для різних запитів', async () => {
    const a = await get('/');
    const b = await get('/');
    const c = await get('/tours/9999');
    for (const res of [a, b, c]) {
      assert.match(res.headers.get('x-process-id'), /^[0-9a-f]{8}$/);
    }
    assert.notEqual(
      a.headers.get('x-process-id'),
      b.headers.get('x-process-id')
    );
  });

  test('збій БД → 500 без внутрішніх деталей, сервер продовжує працювати', async () => {
    await dbExec('DROP TABLE reviews');
    const res = await get('/tours/1');
    assert.equal(res.status, 500);
    assert.match(res.body, /Тимчасова несправність/);
    assert.doesNotMatch(res.body, /no such table|SQLITE/);

    // маршрути, що не чіпають зламану таблицю, відповідають
    assert.equal((await get('/')).status, 200);
  });

  test('БД не ініціалізована → 500, а не падіння процесу', async () => {
    await closeDatabase();
    const res = await get('/');
    assert.equal(res.status, 500);
    assert.doesNotMatch(res.body, /initDatabase/);
  });

  describe('журнал запиту (middleware/requestContext)', () => {
    const waitFor = async (condition) => {
      for (let i = 0; i < 50 && !condition(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };

    test('вхід і завершення запиту логуються з однаковим ID процесу та роллю', async () => {
      const lines = [];
      const restore = logger.setSink((level, line) => lines.push(line));
      try {
        const res = await get('/');
        const processId = res.headers.get('x-process-id');
        const entry = `[process=${processId}] --> GET / (role=guest)`;
        const exit = `[process=${processId}] <-- 200 GET /`;

        // подія 'finish' спрацьовує вже після відправки відповіді
        await waitFor(() => lines.some((l) => l.includes(exit)));

        assert.ok(
          lines.some((l) => l.includes(entry)),
          lines.join('\n')
        );
        assert.ok(
          lines.some((l) => l.includes(exit)),
          lines.join('\n')
        );
      } finally {
        restore();
      }
    });
  });
});
