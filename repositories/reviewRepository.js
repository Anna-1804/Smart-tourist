const { all, run } = require('./base');

exports.listByTour = (tourId) =>
  all(
    'SELECT * FROM reviews WHERE tour_id = ? ORDER BY datetime(created_at) DESC',
    [tourId]
  );

// tourId = null → усі відгуки
exports.list = (tourId) =>
  tourId
    ? all(
        'SELECT * FROM reviews WHERE tour_id = ? ORDER BY datetime(created_at) DESC',
        [tourId]
      )
    : all('SELECT * FROM reviews ORDER BY datetime(created_at) DESC');

exports.insert = (r) =>
  run(
    `INSERT INTO reviews (tour_id, user_name, rating, comment, created_at) VALUES (?, ?, ?, ?, ?)`,
    [r.tourId, r.userName, r.rating, r.comment, r.createdAt]
  );
