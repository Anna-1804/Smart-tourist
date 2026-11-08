const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const tourRepo = require('../../repositories/tourRepository');
const bookingRepo = require('../../repositories/bookingRepository');
const reviewRepo = require('../../repositories/reviewRepository');
const adminService = require('../../services/adminService');

const stub = () => {
  mock.method(tourRepo, 'listCities', async () => ['cities']);
  mock.method(tourRepo, 'listTours', async () => ['tours']);
  const bookings = mock.method(bookingRepo, 'list', async () => ['bookings']);
  const reviews = mock.method(reviewRepo, 'list', async () => ['reviews']);
  return { bookings, reviews };
};

afterEach(() => mock.restoreAll());

describe('adminService.getDashboard', () => {
  for (const raw of [undefined, '']) {
    test(`без фільтра (${JSON.stringify(raw)}): усі бронювання й відгуки`, async () => {
      const { bookings, reviews } = stub();
      const data = await adminService.getDashboard(raw);
      assert.deepEqual(data, {
        cities: ['cities'],
        tours: ['tours'],
        bookings: ['bookings'],
        reviews: ['reviews'],
        selectedTourId: null,
      });
      assert.deepEqual(bookings.mock.calls[0].arguments, [null]);
      assert.deepEqual(reviews.mock.calls[0].arguments, [null]);
    });
  }

  test('tour_id=2: фільтр передається в обидва репозиторії', async () => {
    const { bookings, reviews } = stub();
    const data = await adminService.getDashboard('2');
    assert.equal(data.selectedTourId, 2);
    assert.deepEqual(bookings.mock.calls[0].arguments, [2]);
    assert.deepEqual(reviews.mock.calls[0].arguments, [2]);
  });

  // нечисловий, дробовий, нульовий і від'ємний tour_id
  for (const raw of ['abc', '1.5', '0', '-3']) {
    test(`tour_id=${raw} → 400, запити до БД не виконуються`, async () => {
      const { bookings } = stub();
      await assert.rejects(adminService.getDashboard(raw), (err) => {
        assert.equal(err.status, 400);
        return true;
      });
      assert.equal(bookings.mock.callCount(), 0);
    });
  }
});
