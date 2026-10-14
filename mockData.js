// --- СТАТИЧНІ ДАНІ У ПАМ'ЯТІ (ІМІТАЦІЯ ТАБЛИЦЬ БД) ---
const cities = [
  { id: 1, name: 'Львів', description: 'Культурна столиця України.' },
  { id: 2, name: 'Київ', description: 'Столиця України з багатою історією.' },
];

const tours = [
  {
    id: 1,
    city_id: 1,
    title: 'Замки Львівщини',
    description: 'Екскурсія найвідомішими замками регіону.',
    program: '1. Виїзд зі Львова. 2. Олеський замок. 3. Підгорецький замок.',
    price: 850,
    available_slots: 5,
    image_url:
      'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTcraSpYriXJGvhaLLVOJC0zv5n7xTMwhwfJMb5_uI64c9ODTUBo3CfQTk&s=10',
  },
  {
    id: 2,
    city_id: 2,
    title: 'Таємниці Старого Києва',
    description: 'Пішохідна прогулянка історичним центром.',
    program: '1. Золоті Ворота. 2. Софійський собор. 3. Андріївський узвіз.',
    price: 500,
    available_slots: 10,
    image_url:
      'https://tickikids.ams3.cdn.digitaloceanspaces.com/z1.cache/gallery/activities/9689/image_5aa55395b13a85.56890693.jpg',
  },
];

const bookings = [];

const reviews = [
  {
    id: 1,
    tour_id: 1,
    user_name: 'Олена',
    rating: 5,
    comment: 'Чудова екскурсія! Гід просто супер.',
    created_at: new Date().toLocaleDateString('uk-UA'),
  },
];

module.exports = {
  getCities: () => cities,

  // Сценарій 1.1: Вибір міста та пошук екскурсій
  getToursByCity: (cityId) => {
    if (!cityId) return tours;
    return tours.filter((t) => t.city_id === Number(cityId));
  },

  // Сценарій 1.2: Перегляд детального опису екскурсії
  getTourById: (id) => {
    const tour = tours.find((t) => t.id === Number(id));
    if (!tour) return null;

    const tourReviews = reviews
      .filter((r) => r.tour_id === tour.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const city = cities.find((c) => c.id === tour.city_id);

    return {
      ...tour,
      city_name: city ? city.name : '',
      reviews: tourReviews,
    };
  },

  // Сценарій 1.3: Бронювання місць на екскурсію
  createBooking: ({ tour_id, user_name, user_email, slots_booked }) => {
    if (!user_name || !user_email || !slots_booked) {
      return {
        success: false,
        status: 400,
        message: "Будь ласка, заповніть усі обов'язкові поля.",
      };
    }

    if (!user_email.includes('@')) {
      return {
        success: false,
        status: 400,
        message: 'Вказано некоректний email (відсутній символ @).',
      };
    }

    const slots = Number(slots_booked);
    if (isNaN(slots) || slots <= 0) {
      return {
        success: false,
        status: 400,
        message: 'Кількість місць для бронювання має бути більшою за 0.',
      };
    }

    const tour = tours.find((t) => t.id === Number(tour_id));
    if (!tour) {
      return { success: false, status: 404, message: 'Екскурсію не знайдено.' };
    }

    if (tour.available_slots < slots) {
      return {
        success: false,
        status: 409,
        message: `На жаль, доступно лише ${tour.available_slots} вільних місць.`,
      };
    }

    tour.available_slots -= slots;

    const newBooking = {
      id: bookings.length + 1,
      tour_id: Number(tour_id),
      tour_title: tour.title,
      user_name,
      user_email,
      slots_booked: slots,
      created_at: new Date().toLocaleDateString('uk-UA'),
    };
    bookings.push(newBooking);

    return { success: true, booking: newBooking };
  },

  // Сценарій 1.4: Залишення відгуку про поїздку
  addReview: ({ tour_id, user_name, rating, comment }) => {
    if (!user_name || !rating || !comment) {
      return {
        success: false,
        status: 400,
        message: "Заповніть ім'я, оцінку та текст коментаря.",
      };
    }

    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      return {
        success: false,
        status: 400,
        message: 'Оцінка відгуку має бути від 1 до 5.',
      };
    }

    const tour = tours.find((t) => t.id === Number(tour_id));
    if (!tour) {
      return { success: false, status: 404, message: 'Екскурсію не знайдено.' };
    }

    const newReview = {
      id: reviews.length + 1,
      tour_id: Number(tour_id),
      user_name,
      rating: numRating,
      comment,
      created_at: new Date().toLocaleDateString('uk-UA'),
    };
    reviews.push(newReview);

    return { success: true, review: newReview };
  },

  // Сценарій 2.1: Додавання нових екскурсій (Адмін)
  createTour: ({
    city_id,
    title,
    description,
    program,
    price,
    available_slots,
    image_url,
  }) => {
    if (
      !city_id ||
      !title ||
      price === undefined ||
      available_slots === undefined
    ) {
      return {
        success: false,
        status: 400,
        message: "Заповніть усі обов'язкові поля туру.",
      };
    }

    if (Number(price) < 0 || Number(available_slots) < 0) {
      return {
        success: false,
        status: 400,
        message: "Ціна та кількість місць не можуть бути від'ємними.",
      };
    }

    const newTour = {
      id: tours.length + 1,
      city_id: Number(city_id),
      title,
      description: description || '',
      program: program || '',
      price: Number(price),
      available_slots: Number(available_slots),
      image_url:
        image_url && image_url.trim() !== ''
          ? image_url
          : 'https://images.unsplash.com/photo-1565008447742-97f6f38c985c?w=600',
    };
    tours.push(newTour);

    return { success: true, tour: newTour };
  },

  // Сценарій 2.2: Керування розкладом та оновлення усіх полів туру (Адмін)
  updateTour: (
    id,
    { title, description, program, price, available_slots, image_url }
  ) => {
    const tour = tours.find((t) => t.id === Number(id));
    if (!tour) {
      return {
        success: false,
        status: 404,
        message: 'Екскурсію для оновлення не знайдено.',
      };
    }

    if (price !== undefined && Number(price) < 0) {
      return {
        success: false,
        status: 400,
        message: "Ціна туру не може бути від'ємною.",
      };
    }
    if (available_slots !== undefined && Number(available_slots) < 0) {
      return {
        success: false,
        status: 400,
        message: "Кількість місць не може бути від'ємною.",
      };
    }

    if (title !== undefined) tour.title = title;
    if (description !== undefined) tour.description = description;
    if (program !== undefined) tour.program = program;
    if (image_url !== undefined && image_url.trim() !== '')
      tour.image_url = image_url;
    if (price !== undefined) tour.price = Number(price);
    if (available_slots !== undefined)
      tour.available_slots = Number(available_slots);

    return { success: true, tour };
  },

  // Сценарії 2.3 та 2.4: Геттери для бронювань і відгуків
  getBookings: (tourId) => {
    if (!tourId) return bookings;
    return bookings.filter((b) => b.tour_id === Number(tourId));
  },

  getReviews: (tourId) => {
    if (!tourId) return reviews;
    return reviews.filter((r) => r.tour_id === Number(tourId));
  },
};
