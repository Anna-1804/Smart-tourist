const express = require('express');
const path = require('path');
const mockData = require('./mockData');

const app = express();
const PORT = 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware розмежування ролей (Сценарій помилки 7)
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
  const cities = mockData.getCities();
  const tours = mockData.getToursByCity(selectedCity);

  res.render('index', { cities, tours, selectedCity });
});

// Сценарій 1.2: Перегляд детального опису екскурсії
app.get('/tours/:id', (req, res) => {
  const tour = mockData.getTourById(req.params.id);
  if (!tour) {
    return res.status(404).render('error', {
      message: '404 Not Found: Екскурсію або місто не знайдено.',
    });
  }
  res.render('tour-details', { tour, message: null, isError: false });
});

// Сценарій 1.3: Бронювання місць на екскурсію
app.post('/tours/:id/book', (req, res) => {
  const result = mockData.createBooking({
    tour_id: req.params.id,
    ...req.body,
  });

  const tour = mockData.getTourById(req.params.id);
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

// Сценарій 1.4: Залишення відгуку про поїздку
app.post('/tours/:id/reviews', (req, res) => {
  const result = mockData.addReview({
    tour_id: req.params.id,
    ...req.body,
  });

  const tour = mockData.getTourById(req.params.id);
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

// ==========================================
// СЦЕНАРІЇ АДМІНІСТРАТОРА
// ==========================================

// Сценарії 2.3 та 2.4: Перегляд адмін-панелі, аналіз відгуків та бронювань
app.get('/admin', checkAdminRole, (req, res) => {
  res.render('admin', {
    cities: mockData.getCities(),
    tours: mockData.getToursByCity(),
    bookings: mockData.getBookings(),
    reviews: mockData.getReviews(),
    message: null,
    isError: false,
  });
});

// Сценарій 2.1: Додавання нових екскурсій
app.post('/admin/tours', checkAdminRole, (req, res) => {
  const result = mockData.createTour(req.body);

  res.render('admin', {
    cities: mockData.getCities(),
    tours: mockData.getToursByCity(),
    bookings: mockData.getBookings(),
    reviews: mockData.getReviews(),
    message: result.success ? 'Нову екскурсію успішно додано!' : result.message,
    isError: !result.success,
  });
});

// Сценарій 2.2: Керування розкладом (Оновлення даних туру)
app.post('/admin/tours/:id/update', checkAdminRole, (req, res) => {
  const result = mockData.updateTour(req.params.id, req.body);

  res.render('admin', {
    cities: mockData.getCities(),
    tours: mockData.getToursByCity(),
    bookings: mockData.getBookings(),
    reviews: mockData.getReviews(),
    message: result.success ? 'Параметри екскурсії оновлено!' : result.message,
    isError: !result.success,
  });
});

// Обробка неіснуючих сторінок (Сценарії помилок 2, 6)
app.use((req, res) => {
  res.status(404).render('error', {
    message: '404 Not Found: Запитаний ресурс чи сторінку не знайдено.',
  });
});

app.listen(PORT, () => {
  console.log(`Прототип Smart-tourist запущено: http://localhost:${PORT}`);
});
