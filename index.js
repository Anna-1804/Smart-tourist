const express = require('express');
const path = require('path');
const crypto = require('node:crypto');

const { initDatabase } = require('./database');
const logger = require('./lib/logger');
const requestContext = require('./middleware/requestContext');
const requireAdmin = require('./middleware/requireAdmin');
const errorHandler = require('./middleware/errorHandler');
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require('./lib/errors');

const tourService = require('./services/tourService');
const bookingService = require('./services/bookingService');
const reviewService = require('./services/reviewService');
const adminService = require('./services/adminService');
const healthService = require('./services/healthService');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestContext); // БД, користувач і ID процесу для кожного запиту

// Помилки форм (400, 409) показуємо на тій самій сторінці, але з правильним статусом
const isFormError = (err) =>
  err instanceof ValidationError || err instanceof ConflictError;

const renderTour = async (
  res,
  tourId,
  { message = null, isError = false, status = 200 } = {}
) => {
  const tour = await tourService.getTourDetails(tourId);
  // idempotencyKey потрапляє в приховане поле форми бронювання
  res.status(status).render('tour-details', {
    tour,
    message,
    isError,
    idempotencyKey: crypto.randomUUID(),
  });
};

const renderAdmin = async (
  res,
  { tourId, message = null, isError = false, status = 200 } = {}
) => {
  const data = await adminService.getDashboard(tourId);
  res.status(status).render('admin', { ...data, message, isError });
};

// ==========================================
// СЦЕНАРІЇ КОРИСТУВАЧА
// ==========================================

// Сценарій 1.1: Вибір міста та пошук екскурсій
app.get('/', async (req, res) => {
  const selectedCity = req.query.city_id;
  const [cities, tours] = await Promise.all([
    tourService.listCities(),
    tourService.listTours(selectedCity),
  ]);
  res.render('index', { cities, tours, selectedCity });
});

// Сценарій 1.2: Перегляд детального опису екскурсії
app.get('/tours/:id', async (req, res) => {
  await renderTour(res, req.params.id);
});

// Сценарій 1.3: Бронювання місць на екскурсію
app.post('/tours/:id/book', async (req, res) => {
  try {
    const booking = await bookingService.createBooking(req.params.id, req.body);
    await renderTour(res, req.params.id, {
      message: booking.duplicate
        ? 'Це бронювання вже було оформлено раніше.'
        : 'Місця успішно заброньовані!',
    });
  } catch (err) {
    if (!isFormError(err)) throw err;
    await renderTour(res, req.params.id, {
      message: err.message,
      isError: true,
      status: err.status,
    });
  }
});

// Сценарій 1.4: Залишення відгуку про поїздку
app.post('/tours/:id/reviews', async (req, res) => {
  try {
    await reviewService.addReview(req.params.id, req.body);
    await renderTour(res, req.params.id, {
      message: 'Дякуємо! Ваш відгук оприлюднено.',
    });
  } catch (err) {
    if (!isFormError(err)) throw err;
    await renderTour(res, req.params.id, {
      message: err.message,
      isError: true,
      status: err.status,
    });
  }
});

// ==========================================
// СЦЕНАРІЇ АДМІНІСТРАТОРА
// ==========================================

// Сценарії 2.3 та 2.4: адмін-панель з фільтром за туром (?tour_id=N)
app.get('/admin', requireAdmin, async (req, res) => {
  await renderAdmin(res, { tourId: req.query.tour_id });
});

// Сценарій 2.1: Додавання нових екскурсій
app.post('/admin/tours', requireAdmin, async (req, res) => {
  try {
    await tourService.createTour(req.body);
    await renderAdmin(res, { message: 'Нову екскурсію успішно додано!' });
  } catch (err) {
    if (!isFormError(err)) throw err;
    await renderAdmin(res, {
      message: err.message,
      isError: true,
      status: err.status,
    });
  }
});

// Сценарій 2.2: Керування розкладом (Оновлення даних туру)
app.post('/admin/tours/:id/update', requireAdmin, async (req, res) => {
  try {
    await tourService.updateTour(req.params.id, req.body);
    await renderAdmin(res, { message: 'Параметри екскурсії оновлено!' });
  } catch (err) {
    if (!isFormError(err)) throw err;
    await renderAdmin(res, {
      message: err.message,
      isError: true,
      status: err.status,
    });
  }
});

// ==========================================
// СЛУЖБОВІ ЕНДПОІНТИ (CI/CD)
// ==========================================

// Готовність: blue-green пускає трафік на нову версію лише після 200 звідси
app.get('/health', async (req, res) => {
  const { ok, reason, applied } = await healthService.check();
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'unavailable',
    ...(ok ? {} : { reason }),
    migrations: applied,
  });
});

// SHA задеплоєного коміта (його передає збірка образу через GIT_SHA)
app.get('/version', (req, res) => {
  const sha =
    [process.env.GIT_SHA, process.env.RENDER_GIT_COMMIT].find(
      (v) => v && v !== 'unknown'
    ) || 'unknown';
  res.json({ sha });
});

// Неіснуючі сторінки → у єдиний обробник помилок
app.use((req, res, next) => {
  next(new NotFoundError('Запитаний ресурс чи сторінку не знайдено.'));
});

// Єдиний обробник помилок (має бути останнім)
app.use(errorHandler);

// Явний старт: спершу БД (SELECT 1, схема, міграції), потім сервер.
// Якщо БД недоступна, процес падає одразу. У контейнері міграції виконує
// docker-entrypoint.sh окремими кроками (MIGRATE_ON_START=false): тут лише перевірка.
const start = async () => {
  await initDatabase(undefined, {
    migrate: process.env.MIGRATE_ON_START !== 'false',
  });
  return app.listen(PORT, () => {
    logger.info(
      `Проєкт Smart-tourist на SQLite запущено: http://localhost:${PORT}`
    );
  });
};

// Запускаємо лише якщо файл запущено напряму (щоб Jest не дублював listen)
if (process.env.NODE_ENV !== 'test') {
  start().catch((err) => {
    logger.error(`Не вдалося запустити застосунок: ${err.message}`);
    process.exit(1);
  });
}

module.exports = app;
module.exports.start = start;
