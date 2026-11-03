const { all, run } = require('./base');
const { nowIso } = require('../lib/time');

const ORDER = 'ORDER BY datetime(created_at) DESC, id DESC';

// tourId = null → усі відгуки
exports.list = (tourId) =>
  tourId
    ? all(`SELECT * FROM reviews WHERE tour_id = ? ${ORDER}`, [tourId])
    : all(`SELECT * FROM reviews ${ORDER}`);

exports.listByTour = (tourId) => exports.list(tourId);

// Дата створення ставиться тут у форматі ISO
exports.insert = (r) =>
  run(
    `INSERT INTO reviews (tour_id, user_name, rating, comment, created_at) VALUES (?, ?, ?, ?, ?)`,
    [r.tourId, r.userName, r.rating, r.comment, nowIso()]
  );
