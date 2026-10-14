const express = require('express');
const path = require('path');
const dbStore = require('./models/dbStore');

const app = express();
const PORT = 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware розмежування ролей (Сценарій помилки 5)
const checkAdminRole = (req, res, next) => {
  const role = req.headers['x-user-role'] || req.query.role;
  if (role !== 'admin') {
    return res.status(403).render('error', {
      message:
        '403 Forbidden: Порушення прав доступу. Потрібні права адміністратора.',
    });
  }
  next();
};

// ==========================================
// СЦЕНАРІЇ КОРИСТУВАЧА
// ==========================================

// Сценарій 1.1: Вибір міста та пошук екскурсій
app.get('/', (req, res) => {
  const selectedCity = req.query.city_id;
  
  dbStore.getCities((cities) => {
    dbStore.getToursByCity(selectedCity, (tours) => {
      res.render('index', { cities, tours, selectedCity });
    });
  });
});

// Сценарій 1.2: Перегляд детального опису екскурсії
app.get('/tours/:id', (req, res) => {
  dbStore.getTourById(req.params.id, (tour) => {
    if (!tour) {
      return res.status(404).render('error', {
        message: '404 Not Found: Екскурсію або місто не знайдено.',
      });
    }
    res.render('tour-details', { tour, message: null, isError: false });
  });
});

// Сценарій 1.3: Бронювання місць на екскурсію
app.post('/tours/:id/book', (req, res) => {
  dbStore.createBooking({
    tour_id: req.params.id,
    ...req.body,
  }, (result) => {
    dbStore.getTourById(req.params.id, (tour) => {
      if (!tour) {
        return res
          .status(404)
          .render('error', { message: '404 Not Found: Екскурсію не знайдено.' });
      }

      res.render('tour-details', {
        tour,
        message: result.success ? 'Місця успішно заброньовані!' : result.message,
        isError: !result.success,
      });
    });
  });
});

// Сценарій 1.4: Залишення відгуку про поїздку
app.post('/tours/:id/reviews', (req, res) => {
  dbStore.addReview({
    tour_id: req.params.id,
    ...req.body,
  }, (result) => {
    dbStore.getTourById(req.params.id, (tour) => {
      if (!tour) {
        return res
          .status(404)
          .render('error', { message: '404 Not Found: Екскурсію не знайдено.' });
      }

      res.render('tour-details', {
        tour,
        message: result.success
          ? 'Дякуємо! Ваш відгук оприлюднено.'
          : result.message,
        isError: !result.success,
      });
    });
  });
});

// ==========================================
// СЦЕНАРІЇ АДМІНІСТРАТОРА
// ==========================================

// Сценарії 2.3 та 2.4: Перегляд адмін-панелі, аналіз відгуків та бронювань
app.get('/admin', checkAdminRole, (req, res) => {
  dbStore.getCities((cities) => {
    dbStore.getToursByCity(null, (tours) => {
      dbStore.getBookings(null, (bookings) => {
        dbStore.getReviews(null, (reviews) => {
          res.render('admin', {
            cities,
            tours,
            bookings,
            reviews,
            message: null,
            isError: false,
          });
        });
      });
    });
  });
});

// Сценарій 2.1: Додавання нових екскурсій
app.post('/admin/tours', checkAdminRole, (req, res) => {
  dbStore.createTour(req.body, (result) => {
    dbStore.getCities((cities) => {
      dbStore.getToursByCity(null, (tours) => {
        dbStore.getBookings(null, (bookings) => {
          dbStore.getReviews(null, (reviews) => {
            res.render('admin', {
              cities,
              tours,
              bookings,
              reviews,
              message: result.success ? 'Нову екскурсію успішно додано!' : result.message,
              isError: !result.success,
            });
          });
        });
      });
    });
  });
});

// Сценарій 2.2: Керування розкладом (Оновлення даних туру)
app.post('/admin/tours/:id/update', checkAdminRole, (req, res) => {
  dbStore.updateTour(req.params.id, req.body, (result) => {
    dbStore.getCities((cities) => {
      dbStore.getToursByCity(null, (tours) => {
        dbStore.getBookings(null, (bookings) => {
          dbStore.getReviews(null, (reviews) => {
            res.render('admin', {
              cities,
              tours,
              bookings,
              reviews,
              message: result.success ? 'Параметри екскурсії оновлено!' : result.message,
              isError: !result.success,
            });
          });
        });
      });
    });
  });
});

// Обробка неіснуючих сторінок
app.use((req, res) => {
  res.status(404).render('error', {
    message: '404 Not Found: Запитаний ресурс чи сторінку не знайдено.',
  });
});

app.listen(PORT, () => {
  console.log(`Проєкт Smart-tourist на SQLite запущено: http://localhost:${PORT}`);
});
