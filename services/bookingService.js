const tourRepo = require('../repositories/tourRepository');
const bookingRepo = require('../repositories/bookingRepository');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
} = require('../lib/errors');
const logger = require('../lib/logger');

// Мінімально осмислена адреса: текст@домен.зона, без пробілів
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.createBooking = async (tourId, body = {}) => {
  const { user_name, user_email, slots_booked, idempotency_key } = body;

  if (
    typeof user_name !== 'string' ||
    user_name.trim() === '' ||
    typeof user_email !== 'string' ||
    user_email.trim() === '' ||
    slots_booked === undefined ||
    slots_booked === ''
  ) {
    throw new ValidationError("Будь ласка, заповніть усі обов'язкові поля.");
  }
  if (!EMAIL_PATTERN.test(user_email.trim())) {
    throw new ValidationError(
      'Вказано некоректний email (очікується формат name@example.com).'
    );
  }
  const slots = Number(slots_booked);
  if (Number.isNaN(slots) || slots <= 0) {
    throw new ValidationError(
      'Кількість місць для бронювання має бути більшою за 0.'
    );
  }
  if (!Number.isInteger(slots)) {
    throw new ValidationError('Кількість місць має бути цілим числом.');
  }

  const tour = await tourRepo.findTour(Number(tourId));
  if (!tour) throw new NotFoundError('Екскурсію не знайдено.');

  // Перевірка місць і списання — всередині транзакції репозиторію (без гонки).
  // Ключ ідемпотентності: повторне надсилання форми не створює друге бронювання.
  const key = typeof idempotency_key === 'string' ? idempotency_key.trim() : '';
  const result = await bookingRepo.create({
    tourId: tour.id,
    userName: user_name.trim(),
    userEmail: user_email.trim(),
    slots,
    idempotencyKey: /^[\w-]{8,64}$/.test(key) ? key : null,
  });

  if (!result.booked) {
    // актуальна кількість місць — вже після спроби, а не з попереднього читання
    const fresh = await tourRepo.findTour(tour.id);
    throw new ConflictError(
      `На жаль, доступно лише ${fresh ? fresh.available_slots : 0} вільних місць.`
    );
  }

  logger.info(
    `бронювання ${result.id}: тур ${tour.id}, місць ${slots}${result.duplicate ? ' (повтор, нічого не змінено)' : ''}`
  );
  return {
    id: result.id,
    duplicate: result.duplicate,
    tour_id: tour.id,
    tour_title: tour.title,
    slots_booked: slots,
  };
};
