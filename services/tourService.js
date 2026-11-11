// Сервісний шар: валідація й бізнес-правила. SQL тут немає.
const tourRepo = require('../repositories/tourRepository');
const reviewRepo = require('../repositories/reviewRepository');
const { ValidationError, NotFoundError } = require('../lib/errors');

const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1565008447742-97f6f38c985c?w=600';

// Порожній рядок і рядок із пробілів Number() перетворює на 0, тому перевіряємо окремо
const isBlank = (value) => String(value).trim() === '';

// Спільна перевірка ціни й місць для створення та оновлення туру
const validatePriceAndSlots = (price, availableSlots) => {
  if (price !== undefined) {
    if (isBlank(price) || !Number.isFinite(Number(price))) {
      throw new ValidationError('Ціна має бути числом.');
    }
  }
  if (availableSlots !== undefined) {
    if (isBlank(availableSlots) || !Number.isFinite(Number(availableSlots))) {
      throw new ValidationError('Кількість місць має бути числом.');
    }
  }
};

exports.listCities = () => tourRepo.listCities();

exports.listTours = (cityId) =>
  tourRepo.listTours(cityId ? Number(cityId) : null);

exports.getTourDetails = async (id) => {
  const tour = await tourRepo.findTourWithCity(Number(id));
  if (!tour) throw new NotFoundError('Екскурсію або місто не знайдено.');
  tour.reviews = await reviewRepo.listByTour(tour.id);
  return tour;
};

exports.createTour = async (body = {}) => {
  const {
    city_id,
    title,
    description,
    program,
    price,
    available_slots,
    image_url,
  } = body;

  if (
    !city_id ||
    typeof title !== 'string' ||
    title.trim() === '' ||
    price === undefined ||
    price === '' ||
    available_slots === undefined ||
    available_slots === ''
  ) {
    throw new ValidationError("Заповніть усі обов'язкові поля туру.");
  }
  if (Number(price) < 0 || Number(available_slots) < 0) {
    throw new ValidationError(
      "Ціна та кількість місць не можуть бути від'ємними."
    );
  }
  validatePriceAndSlots(price, available_slots);
  if (!Number.isInteger(Number(available_slots))) {
    throw new ValidationError('Кількість місць має бути цілим числом.');
  }

  const result = await tourRepo.insertTour({
    cityId: Number(city_id),
    title,
    description: description || '',
    program: program || '',
    price: Number(price),
    availableSlots: Number(available_slots),
    imageUrl: image_url && image_url.trim() !== '' ? image_url : DEFAULT_IMAGE,
  });
  return { id: result.lastID };
};

exports.updateTour = async (id, body = {}) => {
  const tour = await tourRepo.findTour(Number(id));
  if (!tour) throw new NotFoundError('Екскурсію для оновлення не знайдено.');

  const { title, description, program, price, available_slots, image_url } =
    body;
  if (title !== undefined && (typeof title !== 'string' || isBlank(title))) {
    throw new ValidationError('Назва туру не може бути порожньою.');
  }
  validatePriceAndSlots(price, available_slots);
  if (price !== undefined && Number(price) < 0) {
    throw new ValidationError("Ціна туру не може бути від'ємною.");
  }
  if (available_slots !== undefined) {
    if (Number(available_slots) < 0) {
      throw new ValidationError("Кількість місць не може бути від'ємною.");
    }
    if (!Number.isInteger(Number(available_slots))) {
      throw new ValidationError('Кількість місць має бути цілим числом.');
    }
  }

  await tourRepo.updateTour(tour.id, {
    title: title !== undefined ? title : tour.title,
    description: description !== undefined ? description : tour.description,
    program: program !== undefined ? program : tour.program,
    price: price !== undefined ? Number(price) : tour.price,
    availableSlots:
      available_slots !== undefined
        ? Number(available_slots)
        : tour.available_slots,
    imageUrl:
      image_url !== undefined && image_url.trim() !== ''
        ? image_url
        : tour.image_url,
  });
};
