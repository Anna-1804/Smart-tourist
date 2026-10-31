const tourRepo = require('../repositories/tourRepository');
const reviewRepo = require('../repositories/reviewRepository');
const { ValidationError, NotFoundError } = require('../lib/errors');
const logger = require('../lib/logger');

exports.addReview = async (tourId, body = {}) => {
  const { user_name, rating, comment } = body;

  if (!user_name || !rating || !comment) {
    throw new ValidationError("Заповніть ім'я, оцінку та текст коментаря.");
  }
  const numRating = Number(rating);
  if (Number.isNaN(numRating) || numRating < 1 || numRating > 5) {
    throw new ValidationError('Оцінка відгуку має бути від 1 до 5.');
  }

  const tour = await tourRepo.findTour(Number(tourId));
  if (!tour) throw new NotFoundError('Екскурсію не знайдено.');

  const result = await reviewRepo.insert({
    tourId: tour.id,
    userName: user_name,
    rating: numRating,
    comment,
    createdAt: new Date().toLocaleDateString('uk-UA'),
  });
  logger.info(`відгук ${result.lastID} до туру ${tour.id}`);
  return { id: result.lastID };
};
