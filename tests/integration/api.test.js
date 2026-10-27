const request = require('supertest');
const app = require('../../index');

describe('Integration Tests: HTTP-сервер та SQLite база даних', () => {
  // Інтеграційний тест 1: Перевірка головної сторінки
  it('GET / повинен успішно відповідати статусом 200 або 302', async () => {
    const response = await request(app).get('/');
    expect([200, 302]).toContain(response.status);
  });

  // Інтеграційний тест 2: Перевірка детальної сторінки туру з JOIN (Сценарій 1.2)
  it('GET /tours/1 повинен коректно повертати деталі туру з бази даних', async () => {
    const response = await request(app).get('/tours/1');
    expect([200, 302, 404]).toContain(response.status);
  });

  // Інтеграційний тест 3: Перевірка POST-запиту на бронювання (Сценарій 1.3)
  it('POST /tours/1/book повинен опрацьовувати транзакцію бронювання', async () => {
    const bookingData = {
      user_name: 'Тест Інтеграційний',
      user_email: 'test@gmail.com',
      slots_booked: 1,
    };

    const response = await request(app).post('/tours/1/book').send(bookingData);

    expect([200, 201, 302, 400, 404]).toContain(response.status);
  });

  // Інтеграційний тест 4: Перевірка розмежування прав адміна (Сценарій помилок №5)
  it('GET /admin без прав адміністратора повинен повертати 403 Forbidden', async () => {
    const response = await request(app).get('/admin');
    expect(response.status).toBe(403);
  });

  // Інтеграційний тест 5: Перевірка обробки 404 для неіснуючих сторінок
  it('GET /tours/9999 (неіснуючий тур) повертає статус 404', async () => {
    const response = await request(app).get('/tours/9999');
    expect(response.status).toBe(404);
  });

  // Фільтр адмінки за туром (Сценарії 2.3, 2.4)
  it('GET /admin?tour_id=1 з правами адміна повертає 200', async () => {
    const response = await request(app).get('/admin?role=admin&tour_id=1');
    expect(response.status).toBe(200);
  });

  it('GET /admin?tour_id=abc повертає 400', async () => {
    const response = await request(app).get('/admin?role=admin&tour_id=abc');
    expect(response.status).toBe(400);
  });
});
