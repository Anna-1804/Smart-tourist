// models/dbStore.js
const db = require('../db');

// Утиліта для виконання запитів із ретраями (обробка збоїв SQLITE_BUSY)
function runWithRetry(query, params = [], retries = 3) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err && err.code === 'SQLITE_BUSY' && retries > 0) {
        setTimeout(() => {
          runWithRetry(query, params, retries - 1)
            .then(resolve)
            .reject(reject);
        }, 300);
      } else if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
}

module.exports = {
  // Отримання списку міст
  getCities: (callback) => {
    db.all(`SELECT * FROM cities`, [], (err, rows) => {
      callback(err ? [] : rows);
    });
  },

  // Сценарій 1.1: Вибір міста та пошук екскурсій
  getToursByCity: (cityId, callback) => {
    let query = `SELECT * FROM tours`;
    let params = [];
    if (cityId) {
      query += ` WHERE city_id = ?`;
      params = [Number(cityId)];
    }
    db.all(query, params, (err, rows) => {
      callback(err ? [] : rows);
    });
  },

  // Сценарій 1.2: Перегляд детального опису екскурсії (тур + місто + відгуки)
  getTourById: (id, callback) => {
    const tourId = Number(id);
    db.get(
      `SELECT tours.*, cities.name AS city_name FROM tours JOIN cities ON tours.city_id = cities.id WHERE tours.id = ?`,
      [tourId],
      (err, tour) => {
        if (err || !tour) return callback(null);

        db.all(
          `SELECT * FROM reviews WHERE tour_id = ? ORDER BY datetime(created_at) DESC`,
          [tourId],
          (errRev, reviews) => {
            tour.reviews = errRev ? [] : reviews;
            callback(tour);
          }
        );
      }
    );
  },

  // Сценарій 1.3: Бронювання місць на екскурсію (з транзакцією та валідацією)
  createBooking: (
    { tour_id, user_name, user_email, slots_booked },
    callback
  ) => {
    if (!user_name || !user_email || !slots_booked) {
      return callback({
        success: false,
        status: 400,
        message: "Будь ласка, заповніть усі обов'язкові поля.",
      });
    }
    if (!user_email.includes('@')) {
      return callback({
        success: false,
        status: 400,
        message: 'Вказано некоректний email (відсутній символ @).',
      });
    }

    const slots = Number(slots_booked);
    if (isNaN(slots) || slots <= 0) {
      return callback({
        success: false,
        status: 400,
        message: 'Кількість місць для бронювання має бути більшою за 0.',
      });
    }

    const tId = Number(tour_id);

    // Перевірка туру та наявності вільних місць
    db.get(`SELECT * FROM tours WHERE id = ?`, [tId], (err, tour) => {
      if (err || !tour) {
        return callback({
          success: false,
          status: 404,
          message: 'Екскурсію не знайдено.',
        });
      }

      if (tour.available_slots < slots) {
        return callback({
          success: false,
          status: 409,
          message: `На жаль, доступно лише ${tour.available_slots} вільних місць.`,
        });
      }

      // ТРАНЗАКЦІЯ БД
      db.serialize(() => {
        db.run('BEGIN TRANSACTION;');

        const dateStr = new Date().toLocaleDateString('uk-UA');

        db.run(
          `INSERT INTO bookings (tour_id, user_name, user_email, slots_booked, created_at) VALUES (?, ?, ?, ?, ?)`,
          [tId, user_name, user_email, slots, dateStr],
          (errIns) => {
            if (errIns) {
              db.run('ROLLBACK;');
              return callback({
                success: false,
                status: 500,
                message: 'Помилка створення бронювання.',
              });
            }
          }
        );

        db.run(
          `UPDATE tours SET available_slots = available_slots - ? WHERE id = ?`,
          [slots, tId],
          (errUpd) => {
            if (errUpd) {
              db.run('ROLLBACK;');
              return callback({
                success: false,
                status: 500,
                message: 'Помилка оновлення місць.',
              });
            }

            db.run('COMMIT;', (errCommit) => {
              if (errCommit) {
                db.run('ROLLBACK;');
                return callback({
                  success: false,
                  status: 500,
                  message: 'Помилка транзакції.',
                });
              }
              callback({
                success: true,
                booking: {
                  tour_id: tId,
                  tour_title: tour.title,
                  user_name,
                  user_email,
                  slots_booked: slots,
                },
              });
            });
          }
        );
      });
    });
  },

  // Сценарій 1.4: Залишення відгуку
  addReview: ({ tour_id, user_name, rating, comment }, callback) => {
    if (!user_name || !rating || !comment) {
      return callback({
        success: false,
        status: 400,
        message: "Заповніть ім'я, оцінку та текст коментаря.",
      });
    }

    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      return callback({
        success: false,
        status: 400,
        message: 'Оцінка відгуку має бути від 1 до 5.',
      });
    }

    const tId = Number(tour_id);

    db.get(`SELECT id FROM tours WHERE id = ?`, [tId], (err, tour) => {
      if (err || !tour) {
        return callback({
          success: false,
          status: 404,
          message: 'Екскурсію не знайдено.',
        });
      }

      const dateStr = new Date().toLocaleDateString('uk-UA');
      db.run(
        `INSERT INTO reviews (tour_id, user_name, rating, comment, created_at) VALUES (?, ?, ?, ?, ?)`,
        [tId, user_name, numRating, comment, dateStr],
        function (errIns) {
          if (errIns) {
            return callback({
              success: false,
              status: 500,
              message: 'Помилка збереження відгуку.',
            });
          }
          callback({
            success: true,
            review: {
              id: this.lastID,
              tour_id: tId,
              user_name,
              rating: numRating,
              comment,
              created_at: dateStr,
            },
          });
        }
      );
    });
  },

  // Сценарій 2.1: Додавання нових екскурсій (Адмін)
  createTour: (
    { city_id, title, description, program, price, available_slots, image_url },
    callback
  ) => {
    if (
      !city_id ||
      !title ||
      price === undefined ||
      available_slots === undefined
    ) {
      return callback({
        success: false,
        status: 400,
        message: "Заповніть усі обов'язкові поля туру.",
      });
    }

    if (Number(price) < 0 || Number(available_slots) < 0) {
      return callback({
        success: false,
        status: 400,
        message: "Ціна та кількість місць не можуть бути від'ємними.",
      });
    }

    const img =
      image_url && image_url.trim() !== ''
        ? image_url
        : 'https://images.unsplash.com/photo-1565008447742-97f6f38c985c?w=600';

    db.run(
      `INSERT INTO tours (city_id, title, description, program, price, available_slots, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(city_id),
        title,
        description || '',
        program || '',
        Number(price),
        Number(available_slots),
        img,
      ],
      function (err) {
        if (err) {
          return callback({
            success: false,
            status: 500,
            message: 'Помилка створення туру.',
          });
        }
        callback({ success: true, tour: { id: this.lastID } });
      }
    );
  },

  // Сценарій 2.2: Керування розкладом та оновлення туру (Адмін)
  updateTour: (
    id,
    { title, description, program, price, available_slots, image_url },
    callback
  ) => {
    const tId = Number(id);

    db.get(`SELECT * FROM tours WHERE id = ?`, [tId], (err, tour) => {
      if (err || !tour) {
        return callback({
          success: false,
          status: 404,
          message: 'Екскурсію для оновлення не знайдено.',
        });
      }

      if (price !== undefined && Number(price) < 0) {
        return callback({
          success: false,
          status: 400,
          message: "Ціна туру не може бути від'ємною.",
        });
      }
      if (available_slots !== undefined && Number(available_slots) < 0) {
        return callback({
          success: false,
          status: 400,
          message: "Кількість місць не може бути від'ємною.",
        });
      }

      const newTitle = title !== undefined ? title : tour.title;
      const newDesc =
        description !== undefined ? description : tour.description;
      const newProg = program !== undefined ? program : tour.program;
      const newImg =
        image_url !== undefined && image_url.trim() !== ''
          ? image_url
          : tour.image_url;
      const newPrice = price !== undefined ? Number(price) : tour.price;
      const newSlots =
        available_slots !== undefined
          ? Number(available_slots)
          : tour.available_slots;

      db.run(
        `UPDATE tours SET title = ?, description = ?, program = ?, price = ?, available_slots = ?, image_url = ? WHERE id = ?`,
        [newTitle, newDesc, newProg, newPrice, newSlots, newImg, tId],
        (errUpd) => {
          if (errUpd) {
            return callback({
              success: false,
              status: 500,
              message: 'Помилка оновлення туру.',
            });
          }
          callback({ success: true });
        }
      );
    });
  },

  // Сценарії 2.3 та 2.4: Отримання всіх бронювань та відгуків для адмін-панелі
  getBookings: (tourId, callback) => {
    let query = `
      SELECT bookings.*, tours.title AS tour_title 
      FROM bookings 
      JOIN tours ON bookings.tour_id = tours.id
    `;
    let params = [];
    if (tourId) {
      query += ` WHERE bookings.tour_id = ?`;
      params = [Number(tourId)];
    }
    query += ` ORDER BY datetime(bookings.created_at) DESC`;

    db.all(query, params, (err, rows) => {
      callback(err ? [] : rows);
    });
  },

  getReviews: (tourId, callback) => {
    let query = `SELECT * FROM reviews`;
    let params = [];
    if (tourId) {
      query += ` WHERE tour_id = ?`;
      params = [Number(tourId)];
    }
    query += ` ORDER BY datetime(created_at) DESC`;

    db.all(query, params, (err, rows) => {
      callback(err ? [] : rows);
    });
  },
};
