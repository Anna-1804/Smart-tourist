// Обмеження БД — остання лінія валідації: зрозумілий 400/409 замість 500.
// Перевіряємо відображення кожного виду помилки SQLite на помилку з HTTP-статусом.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createDb, inRequest } = require('../helpers/env');
const { run } = require('../../repositories/base');

const failsWith = async (sql, params, status, text) => {
  const db = await createDb();
  await inRequest(db, () =>
    assert.rejects(run(sql, params), (err) => {
      assert.equal(err.status, status, err.message);
      assert.match(err.message, text);
      return true;
    })
  );
};

describe('repositories/base: помилки обмежень БД', () => {
  test('FOREIGN KEY → 400', () =>
    failsWith(
      `INSERT INTO tours (city_id, title, price, available_slots, image_url)
       VALUES (999, 'x', 1, 1, 'u')`,
      [],
      400,
      /не існує/
    ));

  test('CHECK (від’ємні місця) → 400', () =>
    failsWith(
      `INSERT INTO tours (city_id, title, price, available_slots, image_url)
       VALUES (1, 'x', 1, -5, 'u')`,
      [],
      400,
      /межі/
    ));

  test('NOT NULL → 400', () =>
    failsWith(
      `INSERT INTO tours (city_id, title, price, available_slots, image_url)
       VALUES (1, NULL, 1, 1, 'u')`,
      [],
      400,
      /обов'язкове поле/
    ));

  test('UNIQUE (повторний ключ ідемпотентності) → 409', async () => {
    const db = await createDb();
    const insert = () =>
      run(
        `INSERT INTO bookings (tour_id, user_name, user_email, slots_booked, created_at, idempotency_key)
         VALUES (1, 'a', 'a@a.a', 1, '2026-01-01 00:00:00', 'same-key-0001')`
      );
    await inRequest(db, async () => {
      await insert();
      await assert.rejects(insert(), (err) => {
        assert.equal(err.status, 409);
        return true;
      });
    });
  });

  test('інша помилка SQLite (синтаксис) повертається без змін', async () => {
    const db = await createDb();
    await inRequest(db, () =>
      assert.rejects(run('INSERT INTO nowhere VALUES (1)'), (err) => {
        assert.equal(err.status, undefined);
        assert.equal(err.code, 'SQLITE_ERROR');
        return true;
      })
    );
  });
});
