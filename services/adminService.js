const tourRepo = require('../repositories/tourRepository');
const bookingRepo = require('../repositories/bookingRepository');
const reviewRepo = require('../repositories/reviewRepository');
const { ValidationError } = require('../lib/errors');

// rawTourId: undefined/'' → усі тури; інакше додатне ціле число
exports.getDashboard = async (rawTourId) => {
  const hasFilter = rawTourId !== undefined && rawTourId !== '';
  const tourId = hasFilter ? Number(rawTourId) : null;

  if (hasFilter && (!Number.isInteger(tourId) || tourId <= 0)) {
    throw new ValidationError('tour_id має бути додатним цілим числом.');
  }

  const [cities, tours, bookings, reviews] = await Promise.all([
    tourRepo.listCities(),
    tourRepo.listTours(null),
    bookingRepo.list(tourId),
    reviewRepo.list(tourId),
  ]);
  return { cities, tours, bookings, reviews, selectedTourId: tourId };
};
