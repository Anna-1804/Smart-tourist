const request = require('supertest');
const app = require('../../index'); // Переконайтеся, що index.js експортує app (module.exports = app)

describe('E2E Tests: Full User & Admin Scenarios', () => {
  // Сценарій 1.1: Перегляд головної сторінки
  test('GET / - Має повертати HTTP 200 та список міст/турів', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toContain('Smart Tourist');
  });

  // Сценарій 1.2: Перегляд існуючого та неіснуючого туру
  test('GET /tours/:id - Має повертати 404 для неіснуючого туру', async () => {
    const res = await request(app).get('/tours/999999');
    expect(res.statusCode).toEqual(404);
  });

  // Сценарій 1.3: Повний цикл бронювання місць
  test('POST /tours/:id/book - Успішне бронювання місць', async () => {
    const bookingPayload = {
      user_name: 'Тестовий Турист',
      user_email: 'testtourist@example.com',
      slots_booked: 1,
    };

    const res = await request(app).post('/tours/1/book').send(bookingPayload);

    // Приймаємо статус 200 або 302
    expect([200, 302]).toContain(res.statusCode);
  });

  // Сценарій 1.4: Додавання відгуку
  test('POST /tours/:id/reviews - Успішне додавання відгуку', async () => {
    const reviewPayload = {
      user_name: 'Олексій',
      rating: 5,
      comment: 'Все було супер!',
    };

    const res = await request(app).post('/tours/1/reviews').send(reviewPayload);

    // Приймаємо статус 200 або 302
    expect([200, 302]).toContain(res.statusCode);
  });

  // Сценарій 2.1-2.4: Доступ до адмін-панелі та розмеження ролей
  test('GET /admin - Має блокувати доступ без ролі адміна (403)', async () => {
    const res = await request(app).get('/admin');
    expect(res.statusCode).toEqual(403);
  });

  test('GET /admin?role=admin - Має надавати доступ адміністратору (200)', async () => {
    const res = await request(app).get('/admin?role=admin');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toContain('Панель Управління Адміністратора');
  });

  // Сценарій 2.1: Створення нового туру адміністратором
  test('POST /admin/tours?role=admin - Створення нового туру', async () => {
    const newTour = {
      city_id: 1,
      title: 'E2E Тестовий Експрес Тур',
      price: 350,
      available_slots: 15,
      description: 'Опис для E2E тесту',
      program: 'Програма тесту',
    };

    const res = await request(app)
      .post('/admin/tours?role=admin')
      .send(newTour);

    // Приймаємо статус 200 або 302
    expect([200, 302]).toContain(res.statusCode);
  });
});
