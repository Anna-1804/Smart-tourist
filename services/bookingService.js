const tourRepo = require('../repositories/tourRepository');
const bookingRepo = require('../repositories/bookingRepository');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
} = require('../lib/errors');
const logger = require('../lib/logger');

exports.createBooking = async (tourId, body = {}) => {
  const { user_name, user_email, slots_booked } = body;

  if (
    !user_name ||
    !user_email ||
    slots_booked === undefined ||
    slots_booked === ''
  ) {
    throw new ValidationError("Будь ласка, заповніть усі обов'язкові поля.");
  }
  if (!user_email.includes('@')) {
    throw new ValidationError(
      'Вказано некоректний email (відсутній символ @).'
    );
  }
  const slots = Number(slots_booked);
  if (Number.isNaN(slots) || slots <= 0) {
    throw new ValidationError(
      'Кількість місць для бронювання має бути більшою за 0.'
    );
  }

  const tour = await tourRepo.findTour(Number(tourId));
  if (!tour) throw new NotFoundError('Екскурсію не знайдено.');
  if (tour.available_slots < slots) {
    throw new ConflictError(
      `На жаль, доступно лише ${tour.available_slots} вільних місць.`
    );
  }

  const { booked } = await bookingRepo.create({
    tourId: tour.id,
    userName: user_name,
    userEmail: user_email,
    slots,
    createdAt: new Date().toLocaleDateString('uk-UA'),
  });
  if (!booked) {
    throw new ConflictError(
      'Вільні місця щойно закінчились. Спробуйте ще раз.'
    );
  }

  logger.info(`бронювання: тур ${tour.id}, місць ${slots}`);
  return { tour_id: tour.id, tour_title: tour.title, slots_booked: slots };
};
