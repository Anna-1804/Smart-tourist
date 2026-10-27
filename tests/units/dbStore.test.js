const dbStore = require('../../models/dbStore');

describe('Unit Tests: Повне покриття всіх сценаріїв та гілок dbStore.js', () => {
  // --- СЦЕНАРІЙ 1.3: Бронювання (createBooking) ---
  describe('createBooking Validation & Branch Coverage', () => {
    it('Повертає 400, якщо пропущені обов`язкові поля', (done) => {
      dbStore.createBooking(
        {
          tour_id: 1,
          user_name: '',
          user_email: 'test@gmail.com',
          slots_booked: 1,
        },
        (res) => {
          expect(res.success).toBe(false);
          expect(res.status).toBe(400);
          expect(res.message).toBe(
            "Будь ласка, заповніть усі обов'язкові поля."
          );
          done();
        }
      );
    });

    it('Повертає 400, якщо email не містить @', (done) => {
      dbStore.createBooking(
        {
          tour_id: 1,
          user_name: 'Олена',
          user_email: 'invalid-email',
          slots_booked: 1,
        },
        (res) => {
          expect(res.success).toBe(false);
          expect(res.status).toBe(400);
          expect(res.message).toContain('некоректний email');
          done();
        }
      );
    });

    it('Повертає 400, якщо кількість місць <= 0', (done) => {
      dbStore.createBooking(
        {
          tour_id: 1,
          user_name: 'Олена',
          user_email: 'elena@gmail.com',
          slots_booked: 0,
        },
        (res) => {
          expect(res.success).toBe(false);
          expect(res.status).toBe(400);
          expect(res.message).toBe(
            'Кількість місць для бронювання має бути більшою за 0.'
          );
          done();
        }
      );
    });

    it('Повертає 404, якщо екскурсію для бронювання не знайдено в БД', (done) => {
      dbStore.createBooking(
        {
          tour_id: 9999,
          user_name: 'Олена',
          user_email: 'elena@gmail.com',
          slots_booked: 1,
        },
        (res) => {
          expect(res.success).toBe(false);
          expect(res.status).toBe(404);
          expect(res.message).toBe('Екскурсію не знайдено.');
          done();
        }
      );
    });

    it('Повертає 409, якщо недостатньо вільних місць (овербукінг)', (done) => {
      dbStore.createBooking(
        {
          tour_id: 1,
          user_name: 'Олена',
          user_email: 'elena@gmail.com',
          slots_booked: 1000,
        },
        (res) => {
          expect(res.success).toBe(false);
          expect(res.status).toBe(409);
          expect(res.message).toContain('доступно лише');
          done();
        }
      );
    });
  });

  // --- СЦЕНАРІЙ 1.4: Відгуки (addReview) ---
  describe('addReview Validation & Branch Coverage', () => {
    it('Повертає 400, якщо не заповнено ім`я, оцінку чи коментар', (done) => {
      dbStore.addReview(
        { tour_id: 1, user_name: '', rating: 5, comment: 'Супер' },
        (res) => {
          expect(res.success).toBe(false);
          expect(res.status).toBe(400);
          expect(res.message).toBe(
            "Заповніть ім'я, оцінку та текст коментаря."
          );
          done();
        }
      );
    });

    it('Повертає 400, якщо оцінка поза межами шкали 1-5 (наприклад, 6)', (done) => {
      dbStore.addReview(
        { tour_id: 1, user_name: 'Іван', rating: 6, comment: 'Добре' },
        (res) => {
          expect(res.success).toBe(false);
          expect(res.status).toBe(400);
          expect(res.message).toBe('Оцінка відгуку має бути від 1 до 5.');
          done();
        }
      );
    });

    it('Повертає 404, якщо тур для відгуку не знайдено', (done) => {
      dbStore.addReview(
        { tour_id: 9999, user_name: 'Іван', rating: 5, comment: 'Клас' },
        (res) => {
          expect(res.success).toBe(false);
          expect(res.status).toBe(404);
          expect(res.message).toBe('Екскурсію не знайдено.');
          done();
        }
      );
    });
  });

  // --- СЦЕНАРІЙ 2.1: Створення туру (createTour) ---
  describe('createTour Validation & Branch Coverage', () => {
    it('Повертає 400, якщо пропущені обов`язкові поля туру', (done) => {
      dbStore.createTour(
        { city_id: 1, title: '', price: 500, available_slots: 10 },
        (res) => {
          expect(res.success).toBe(false);
          expect(res.status).toBe(400);
          expect(res.message).toBe("Заповніть усі обов'язкові поля туру.");
          done();
        }
      );
    });

    it('Повертає 400, якщо ціна або доступні місця від`ємні', (done) => {
      dbStore.createTour(
        { city_id: 1, title: 'Тур', price: -100, available_slots: 5 },
        (res) => {
          expect(res.success).toBe(false);
          expect(res.status).toBe(400);
          expect(res.message).toBe(
            "Ціна та кількість місць не можуть бути від'ємними."
          );
          done();
        }
      );
    });
  });

  // --- СЦЕНАРІЙ 2.2: Оновлення туру (updateTour) ---
  describe('updateTour Validation & Branch Coverage', () => {
    it('Повертає 404, якщо тур для оновлення не знайдено', (done) => {
      dbStore.updateTour(9999, { price: 500 }, (res) => {
        expect(res.success).toBe(false);
        expect(res.status).toBe(404);
        expect(res.message).toBe('Екскурсію для оновлення не знайдено.');
        done();
      });
    });

    it('Повертає 400, якщо оновлена ціна або місця є від`ємними', (done) => {
      dbStore.updateTour(1, { price: -50 }, (res) => {
        expect(res.success).toBe(false);
        expect(res.status).toBe(400);
        expect(res.message).toBe("Ціна туру не може бути від'ємною.");
        done();
      });
    });
  });
});
