const { all, get, run } = require('./base');

exports.listCities = () => all('SELECT * FROM cities');

exports.listTours = (cityId) =>
  cityId
    ? all('SELECT * FROM tours WHERE city_id = ?', [cityId])
    : all('SELECT * FROM tours');

exports.findTour = (id) => get('SELECT * FROM tours WHERE id = ?', [id]);

exports.findTourWithCity = (id) =>
  get(
    `SELECT tours.*, cities.name AS city_name
     FROM tours JOIN cities ON tours.city_id = cities.id
     WHERE tours.id = ?`,
    [id]
  );

exports.insertTour = (t) =>
  run(
    `INSERT INTO tours (city_id, title, description, program, price, available_slots, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      t.cityId,
      t.title,
      t.description,
      t.program,
      t.price,
      t.availableSlots,
      t.imageUrl,
    ]
  );

exports.updateTour = (id, t) =>
  run(
    `UPDATE tours SET title = ?, description = ?, program = ?, price = ?, available_slots = ?, image_url = ?
     WHERE id = ?`,
    [
      t.title,
      t.description,
      t.program,
      t.price,
      t.availableSlots,
      t.imageUrl,
      id,
    ]
  );
