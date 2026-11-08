const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const tourRepo = require('../../repositories/tourRepository');
const reviewRepo = require('../../repositories/reviewRepository');
const reviewService = require('../../services/reviewService');

const VALID = { user_name: 'Олена', rating: '5', comment: 'Чудово!' };

const rejectsWith = (promise, status, text) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.status, status);
    assert.match(err.message, text);
    return true;
  });

afterEach(() => mock.restoreAll());

describe('reviewService.addReview', () => {
  test('коректний відгук зберігається з числовою оцінкою', async () => {
    mock.method(tourRepo, 'findTour', async () => ({ id: 2 }));
    const insert = mock.method(reviewRepo, 'insert', async () => ({
      lastID: 9,
    }));
    assert.deepEqual(await reviewService.addReview('2', VALID), { id: 9 });
    assert.deepEqual(insert.mock.calls[0].arguments[0], {
      tourId: 2,
      userName: 'Олена',
      rating: 5,
      comment: 'Чудово!',
    });
  });

  for (const field of ['user_name', 'rating', 'comment']) {
    test(`без поля ${field} → 400`, async () => {
      await rejectsWith(
        reviewService.addReview('2', { ...VALID, [field]: '' }),
        400,
        /Заповніть/
      );
    });
  }

  test('порожнє тіло → 400', async () => {
    await rejectsWith(reviewService.addReview('2'), 400, /Заповніть/);
  });

  // межі шкали 1–5 і нецілі значення
  for (const rating of ['0', '6', '2.5', 'abc', '-1']) {
    test(`оцінка ${rating} поза шкалою → 400`, async () => {
      await rejectsWith(
        reviewService.addReview('2', { ...VALID, rating }),
        400,
        /від 1 до 5/
      );
    });
  }

  for (const rating of ['1', '5']) {
    test(`гранична оцінка ${rating} допустима`, async () => {
      mock.method(tourRepo, 'findTour', async () => ({ id: 2 }));
      mock.method(reviewRepo, 'insert', async () => ({ lastID: 1 }));
      await reviewService.addReview('2', { ...VALID, rating });
    });
  }

  test('немає туру → 404, відгук не зберігається', async () => {
    mock.method(tourRepo, 'findTour', async () => undefined);
    const insert = mock.method(reviewRepo, 'insert', async () => ({}));
    await rejectsWith(
      reviewService.addReview('999', VALID),
      404,
      /не знайдено/
    );
    assert.equal(insert.mock.callCount(), 0);
  });
});
