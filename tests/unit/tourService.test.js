// Unit-тести сервісу турів: репозиторій підмінено, БД не потрібна.
// Перевіряємо кожну гілку валідації та значення за замовчуванням.
const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const tourRepo = require('../../repositories/tourRepository');
const reviewRepo = require('../../repositories/reviewRepository');
const tourService = require('../../services/tourService');

const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1565008447742-97f6f38c985c?w=600';

const VALID = {
  city_id: '1',
  title: 'Нова екскурсія',
  description: 'Опис',
  program: 'Програма',
  price: '300',
  available_slots: '10',
  image_url: 'https://example.com/a.jpg',
};

const EXISTING = {
  id: 7,
  title: 'Стара назва',
  description: 'Старий опис',
  program: 'Стара програма',
  price: 100,
  available_slots: 5,
  image_url: 'https://example.com/old.jpg',
};

const rejectsWith = (promise, status, text) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.status, status);
    assert.match(err.message, text);
    return true;
  });

afterEach(() => mock.restoreAll());

describe('tourService: читання', () => {
  test('listCities повертає міста з репозиторію', async () => {
    mock.method(tourRepo, 'listCities', async () => [{ id: 1 }]);
    assert.deepEqual(await tourService.listCities(), [{ id: 1 }]);
  });

  test('listTours без міста передає null', async () => {
    const list = mock.method(tourRepo, 'listTours', async () => []);
    await tourService.listTours(undefined);
    assert.deepEqual(list.mock.calls[0].arguments, [null]);
  });

  test('listTours перетворює city_id на число', async () => {
    const list = mock.method(tourRepo, 'listTours', async () => []);
    await tourService.listTours('2');
    assert.deepEqual(list.mock.calls[0].arguments, [2]);
  });

  test('getTourDetails додає відгуки до туру', async () => {
    mock.method(tourRepo, 'findTourWithCity', async (id) => ({ id }));
    mock.method(reviewRepo, 'listByTour', async () => [{ rating: 5 }]);
    const tour = await tourService.getTourDetails('3');
    assert.deepEqual(tour, { id: 3, reviews: [{ rating: 5 }] });
  });

  test('getTourDetails: немає туру → 404, відгуки не читаються', async () => {
    mock.method(tourRepo, 'findTourWithCity', async () => undefined);
    const reviews = mock.method(reviewRepo, 'listByTour', async () => []);
    await rejectsWith(tourService.getTourDetails('999'), 404, /не знайдено/);
    assert.equal(reviews.mock.callCount(), 0);
  });
});

describe('tourService.createTour', () => {
  let insert;
  beforeEach(() => {
    insert = mock.method(tourRepo, 'insertTour', async () => ({ lastID: 42 }));
  });

  test('коректні дані → запис і id', async () => {
    assert.deepEqual(await tourService.createTour(VALID), { id: 42 });
    assert.deepEqual(insert.mock.calls[0].arguments[0], {
      cityId: 1,
      title: 'Нова екскурсія',
      description: 'Опис',
      program: 'Програма',
      price: 300,
      availableSlots: 10,
      imageUrl: 'https://example.com/a.jpg',
    });
  });

  // кожне обов'язкове поле окремо: так спрацьовує кожна гілка умови
  const missing = [
    ['city_id', undefined],
    ['title', ''],
    ['price', undefined],
    ['price', ''],
    ['available_slots', undefined],
    ['available_slots', ''],
  ];
  for (const [field, value] of missing) {
    test(`без поля ${field} (${JSON.stringify(value)}) → 400`, async () => {
      await rejectsWith(
        tourService.createTour({ ...VALID, [field]: value }),
        400,
        /обов'язкові/
      );
      assert.equal(insert.mock.callCount(), 0);
    });
  }

  test('порожнє тіло запиту → 400', async () => {
    await rejectsWith(tourService.createTour(), 400, /обов'язкові/);
  });

  test("від'ємна ціна → 400", async () => {
    await rejectsWith(
      tourService.createTour({ ...VALID, price: '-1' }),
      400,
      /від'ємними/
    );
  });

  test("від'ємна кількість місць → 400", async () => {
    await rejectsWith(
      tourService.createTour({ ...VALID, available_slots: '-5' }),
      400,
      /від'ємними/
    );
  });

  test('нуль у ціні та місцях допустимий (межа)', async () => {
    await tourService.createTour({
      ...VALID,
      price: '0',
      available_slots: '0',
    });
    const saved = insert.mock.calls[0].arguments[0];
    assert.equal(saved.price, 0);
    assert.equal(saved.availableSlots, 0);
  });

  test('без опису, програми й фото підставляються значення за замовчуванням', async () => {
    await tourService.createTour({
      city_id: '1',
      title: 'Тур',
      price: '1',
      available_slots: '1',
    });
    const saved = insert.mock.calls[0].arguments[0];
    assert.equal(saved.description, '');
    assert.equal(saved.program, '');
    assert.equal(saved.imageUrl, DEFAULT_IMAGE);
  });

  test('URL фото з самих пробілів вважається порожнім', async () => {
    await tourService.createTour({ ...VALID, image_url: '   ' });
    assert.equal(insert.mock.calls[0].arguments[0].imageUrl, DEFAULT_IMAGE);
  });
});

describe('tourService.updateTour', () => {
  let update;
  beforeEach(() => {
    mock.method(tourRepo, 'findTour', async (id) =>
      id === 7 ? { ...EXISTING } : undefined
    );
    update = mock.method(tourRepo, 'updateTour', async () => ({ changes: 1 }));
  });

  test('немає туру → 404, оновлення не виконується', async () => {
    await rejectsWith(tourService.updateTour('999', {}), 404, /не знайдено/);
    assert.equal(update.mock.callCount(), 0);
  });

  test('порожнє тіло: усі поля лишаються старими', async () => {
    await tourService.updateTour('7');
    assert.deepEqual(update.mock.calls[0].arguments, [
      7,
      {
        title: 'Стара назва',
        description: 'Старий опис',
        program: 'Стара програма',
        price: 100,
        availableSlots: 5,
        imageUrl: 'https://example.com/old.jpg',
      },
    ]);
  });

  test('усі поля передані: беруться нові значення', async () => {
    await tourService.updateTour('7', {
      title: 'Нова',
      description: 'Новий опис',
      program: 'Нова програма',
      price: '250',
      available_slots: '3',
      image_url: 'https://example.com/new.jpg',
    });
    assert.deepEqual(update.mock.calls[0].arguments[1], {
      title: 'Нова',
      description: 'Новий опис',
      program: 'Нова програма',
      price: 250,
      availableSlots: 3,
      imageUrl: 'https://example.com/new.jpg',
    });
  });

  test('порожній URL фото не затирає старий', async () => {
    await tourService.updateTour('7', { image_url: '  ' });
    assert.equal(
      update.mock.calls[0].arguments[1].imageUrl,
      'https://example.com/old.jpg'
    );
  });

  test('нуль у ціні й місцях допустимий (межа)', async () => {
    await tourService.updateTour('7', { price: '0', available_slots: '0' });
    const saved = update.mock.calls[0].arguments[1];
    assert.equal(saved.price, 0);
    assert.equal(saved.availableSlots, 0);
  });

  test("від'ємна ціна → 400", async () => {
    await rejectsWith(
      tourService.updateTour('7', { price: '-1' }),
      400,
      /Ціна/
    );
    assert.equal(update.mock.callCount(), 0);
  });

  test("від'ємна кількість місць → 400", async () => {
    await rejectsWith(
      tourService.updateTour('7', { available_slots: '-1' }),
      400,
      /місць/
    );
    assert.equal(update.mock.callCount(), 0);
  });
});

describe('tourService: валідація, яку раніше пропускали зелені тести', () => {
  let insert;
  let update;
  beforeEach(() => {
    mock.method(tourRepo, 'findTour', async (id) =>
      id === 7 ? { ...EXISTING } : undefined
    );
    insert = mock.method(tourRepo, 'insertTour', async () => ({ lastID: 1 }));
    update = mock.method(tourRepo, 'updateTour', async () => ({ changes: 1 }));
  });

  const badUpdates = [
    ['порожня ціна', { price: '' }, /Ціна/],
    ['ціна не число', { price: 'abc' }, /Ціна/],
    ['порожня кількість місць', { available_slots: '' }, /місць/],
    ['кількість місць не число', { available_slots: 'abc' }, /місць/],
    ['дробова кількість місць', { available_slots: '2.5' }, /цілим/],
    ['порожня назва', { title: '' }, /Назва/],
    ['назва з самих пробілів', { title: '   ' }, /Назва/],
  ];
  for (const [title, body, text] of badUpdates) {
    test(`updateTour: ${title} → 400, дані не змінюються`, async () => {
      await rejectsWith(tourService.updateTour('7', body), 400, text);
      assert.equal(update.mock.callCount(), 0);
    });
  }

  const badCreates = [
    ['ціна не число', { price: 'abc' }, /Ціна/],
    ['дробова кількість місць', { available_slots: '2.5' }, /цілим/],
    ['назва з самих пробілів', { title: '   ' }, /обов'язкові/],
  ];
  for (const [title, fields, text] of badCreates) {
    test(`createTour: ${title} → 400, тур не створюється`, async () => {
      await rejectsWith(
        tourService.createTour({ ...VALID, ...fields }),
        400,
        text
      );
      assert.equal(insert.mock.callCount(), 0);
    });
  }
});
