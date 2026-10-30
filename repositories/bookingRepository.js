const { all, run, transaction } = require('./base');

// tourId = null → усі бронювання
exports.list = (tourId) => {
  const base = `SELECT bookings.*, tours.title AS tour_title
                FROM bookings JOIN tours ON bookings.tour_id = tours.id`;
  return tourId
    ? all(
        `${base} WHERE bookings.tour_id = ? ORDER BY datetime(bookings.created_at) DESC`,
        [tourId]
      )
    : all(`${base} ORDER BY datetime(bookings.created_at) DESC`);
};

// Транзакція: зменшити вільні місця й додати бронювання.
// Повертає { booked: false }, якщо місць уже не вистачає.
exports.create = (b) =>
  transaction(async () => {
    const updated = await run(
      `UPDATE tours SET available_slots = available_slots - ?
       WHERE id = ? AND available_slots >= ?`,
      [b.slots, b.tourId, b.slots]
    );
    if (updated.changes === 0) return { booked: false };

    await run(
      `INSERT INTO bookings (tour_id, user_name, user_email, slots_booked, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [b.tourId, b.userName, b.userEmail, b.slots, b.createdAt]
    );
    return { booked: true };
  });
