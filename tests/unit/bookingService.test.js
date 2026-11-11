const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const tourRepo = require('../../repositories/tourRepository');
const bookingRepo = require('../../repositories/bookingRepository');
const bookingService = require('../../services/bookingService');

const KEY = 'key-unit-0001';
const VALID = {
  user_name: 'Олена',
  user_email: 'elena@gmail.com',
  slots_booked: '2',
  idempotency_key: KEY,
};

const rejectsWith = (promise, status, text) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.status, status);
    assert.match(err.message, text);
    return true;
  });

const stubTour = (tour = { id: 1, title: 'Тур', available_slots: 5 }) =>
  mock.method(tourRepo, 'findTour', async () => tour);

afterEach(() => mock.restoreAll());

describe('bookingService.createBooking: валідація', () => {
  for (const field of ['user_name', 'user_email']) {
    test(`без ${field} → 400`, async () => {
      await rejectsWith(
        bookingService.createBooking('1', { ...VALID, [field]: '' }),
        400,
        /обов'язкові/
      );
    });
  }

  for (const value of [undefined, '']) {
    test(`кількість місць ${JSON.stringify(value)} → 400`, async () => {
      await rejectsWith(
        bookingService.createBooking('1', { ...VALID, slots_booked: value }),
        400,
        /обов'язкові/
      );
    });
  }

  test('порожнє тіло → 400', async () => {
    await rejectsWith(bookingService.createBooking('1'), 400, /обов'язкові/);
  });

  test('email без @ → 400', async () => {
    await rejectsWith(
      bookingService.createBooking('1', { ...VALID, user_email: 'bad' }),
      400,
      /email/
    );
  });

  for (const slots of ['abc', '0', '-2']) {
    test(`кількість місць ${slots} → 400`, async () => {
      await rejectsWith(
        bookingService.createBooking('1', { ...VALID, slots_booked: slots }),
        400,
        /більшою за 0/
      );
    });
  }

  test('дробова кількість місць → 400', async () => {
    await rejectsWith(
      bookingService.createBooking('1', { ...VALID, slots_booked: '1.5' }),
      400,
      /цілим числом/
    );
  });

  test('немає туру → 404, бронювання не створюється', async () => {
    stubTour(null);
    const create = mock.method(bookingRepo, 'create', async () => ({}));
    await rejectsWith(
      bookingService.createBooking('9', VALID),
      404,
      /не знайдено/
    );
    assert.equal(create.mock.callCount(), 0);
  });
});

describe('bookingService.createBooking: бронювання', () => {
  test('успіх: ключ ідемпотентності передається в репозиторій', async () => {
    stubTour();
    const create = mock.method(bookingRepo, 'create', async () => ({
      booked: true,
      duplicate: false,
      id: 11,
    }));
    const result = await bookingService.createBooking('1', VALID);
    assert.deepEqual(result, {
      id: 11,
      duplicate: false,
      tour_id: 1,
      tour_title: 'Тур',
      slots_booked: 2,
    });
    assert.equal(create.mock.calls[0].arguments[0].idempotencyKey, KEY);
    assert.equal(create.mock.calls[0].arguments[0].slots, 2);
  });

  test('повтор із тим самим ключем: duplicate=true', async () => {
    stubTour();
    mock.method(bookingRepo, 'create', async () => ({
      booked: true,
      duplicate: true,
      id: 11,
    }));
    const result = await bookingService.createBooking('1', VALID);
    assert.equal(result.duplicate, true);
  });

  // ключ має бути рядком 8–64 символи з [A-Za-z0-9_-], інакше ігнорується
  const badKeys = [undefined, 123, 'short', 'has space in key', 'x'.repeat(65)];
  for (const key of badKeys) {
    test(`некоректний ключ ${JSON.stringify(key)} ігнорується (null)`, async () => {
      stubTour();
      const create = mock.method(bookingRepo, 'create', async () => ({
        booked: true,
      }));
      await bookingService.createBooking('1', {
        ...VALID,
        idempotency_key: key,
      });
      assert.equal(create.mock.calls[0].arguments[0].idempotencyKey, null);
    });
  }

  test('ключ із пробілами по краях обрізається', async () => {
    stubTour();
    const create = mock.method(bookingRepo, 'create', async () => ({
      booked: true,
    }));
    await bookingService.createBooking('1', {
      ...VALID,
      idempotency_key: `  ${KEY}  `,
    });
    assert.equal(create.mock.calls[0].arguments[0].idempotencyKey, KEY);
  });

  test('місць не вистачило → 409 з актуальною кількістю', async () => {
    const find = mock.method(tourRepo, 'findTour', async () => ({ id: 1 }));
    mock.method(bookingRepo, 'create', async () => ({ booked: false }));
    find.mock.mockImplementation(async () => ({
      id: 1,
      available_slots: 1,
    }));
    await rejectsWith(
      bookingService.createBooking('1', VALID),
      409,
      /лише 1 вільних/
    );
  });

  test('місць не вистачило, а тур зник → 409 з нулем місць', async () => {
    let calls = 0;
    mock.method(tourRepo, 'findTour', async () =>
      (calls += 1) === 1 ? { id: 1, title: 'Тур' } : undefined
    );
    mock.method(bookingRepo, 'create', async () => ({ booked: false }));
    await rejectsWith(
      bookingService.createBooking('1', VALID),
      409,
      /лише 0 вільних/
    );
  });
});

describe('bookingService.createBooking: слабка валідація, яку раніше пропускали тести', () => {
  test('імʼя з самих пробілів → 400, бронювання не створюється', async () => {
    const create = mock.method(bookingRepo, 'create', async () => ({}));
    await rejectsWith(
      bookingService.createBooking('1', { ...VALID, user_name: '   ' }),
      400,
      /обов'язкові/
    );
    assert.equal(create.mock.callCount(), 0);
  });

  for (const email of ['@', 'a@', '@b', 'a@b', 'a b@c.d']) {
    test(`некоректний email ${JSON.stringify(email)} → 400`, async () => {
      const create = mock.method(bookingRepo, 'create', async () => ({}));
      await rejectsWith(
        bookingService.createBooking('1', { ...VALID, user_email: email }),
        400,
        /email/
      );
      assert.equal(create.mock.callCount(), 0);
    });
  }
});
