// Перенесені на сервіси кейси зі старого tests/units/dbStore.test.js:
// ті самі вхідні дані й повідомлення, але перевіряємо шар сервісів на справжній БД
// (без callback-API і без валідації, змішаної з SQL).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, inRequest } = require('../helpers/env');
const bookingService = require('../../services/bookingService');
const reviewService = require('../../services/reviewService');
const tourService = require('../../services/tourService');

const KEY = 'key-services-0001';

// перевіряє і HTTP-статус, і текст помилки
const rejects = (promise, status, message, { contains = false } = {}) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.status, status);
    if (contains) assert.ok(err.message.includes(message), err.message);
    else assert.equal(err.message, message);
    return true;
  });

const book = (db, tourId, body) =>
  inRequest(db, () =>
    bookingService.createBooking(tourId, { idempotency_key: KEY, ...body })
  );

const OK_BOOKING = {
  user_name: 'Олена',
  user_email: 'elena@gmail.com',
  slots_booked: 1,
};

test('бронювання: 400, якщо пропущені обов’язкові поля', async () => {
  const db = await createDb();
  await rejects(
    book(db, 1, { ...OK_BOOKING, user_name: '' }),
    400,
    "Будь ласка, заповніть усі обов'язкові поля."
  );
});

test('бронювання: 400, якщо email без @', async () => {
  const db = await createDb();
  await rejects(
    book(db, 1, { ...OK_BOOKING, user_email: 'invalid-email' }),
    400,
    'некоректний email',
    { contains: true }
  );
});

test('бронювання: 400, якщо кількість місць <= 0', async () => {
  const db = await createDb();
  await rejects(
    book(db, 1, { ...OK_BOOKING, slots_booked: 0 }),
    400,
    'Кількість місць для бронювання має бути більшою за 0.'
  );
});

test('бронювання: 404, якщо екскурсії немає в БД', async () => {
  const db = await createDb();
  await rejects(book(db, 9999, OK_BOOKING), 404, 'Екскурсію не знайдено.');
});

test('бронювання: 409 при овербукінгу, місця не змінюються', async () => {
  const db = await createDb();
  await rejects(
    book(db, 1, { ...OK_BOOKING, slots_booked: 1000 }),
    409,
    'доступно лише',
    { contains: true }
  );
  const row = await db.execute(
    'SELECT available_slots AS n FROM tours WHERE id = 1',
    [],
    'get'
  );
  assert.equal(row.n, 5);
});

test('відгук: 400, якщо не заповнено ім’я, оцінку чи коментар', async () => {
  const db = await createDb();
  await rejects(
    inRequest(db, () =>
      reviewService.addReview(1, { user_name: '', rating: 5, comment: 'Супер' })
    ),
    400,
    "Заповніть ім'я, оцінку та текст коментаря."
  );
});

test('відгук: 400, якщо оцінка поза шкалою 1–5', async () => {
  const db = await createDb();
  await rejects(
    inRequest(db, () =>
      reviewService.addReview(1, {
        user_name: 'Іван',
        rating: 6,
        comment: 'Добре',
      })
    ),
    400,
    'Оцінка відгуку має бути від 1 до 5.'
  );
});

test('відгук: 404, якщо туру не існує', async () => {
  const db = await createDb();
  await rejects(
    inRequest(db, () =>
      reviewService.addReview(9999, {
        user_name: 'Іван',
        rating: 5,
        comment: 'Клас',
      })
    ),
    404,
    'Екскурсію не знайдено.'
  );
});

test('створення туру: 400, якщо пропущені обов’язкові поля', async () => {
  const db = await createDb();
  await rejects(
    inRequest(
      db,
      () =>
        tourService.createTour({
          city_id: 1,
          title: '',
          price: 500,
          available_slots: 10,
        }),
      { role: 'admin' }
    ),
    400,
    "Заповніть усі обов'язкові поля туру."
  );
});

test('створення туру: 400, якщо ціна від’ємна', async () => {
  const db = await createDb();
  await rejects(
    inRequest(
      db,
      () =>
        tourService.createTour({
          city_id: 1,
          title: 'Тур',
          price: -100,
          available_slots: 5,
        }),
      { role: 'admin' }
    ),
    400,
    "Ціна та кількість місць не можуть бути від'ємними."
  );
});

test('оновлення туру: 404, якщо туру немає', async () => {
  const db = await createDb();
  await rejects(
    inRequest(db, () => tourService.updateTour(9999, { price: 500 }), {
      role: 'admin',
    }),
    404,
    'Екскурсію для оновлення не знайдено.'
  );
});

test('оновлення туру: 400, якщо ціна від’ємна', async () => {
  const db = await createDb();
  await rejects(
    inRequest(db, () => tourService.updateTour(1, { price: -50 }), {
      role: 'admin',
    }),
    400,
    "Ціна туру не може бути від'ємною."
  );
});
