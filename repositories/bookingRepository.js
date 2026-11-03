const { all, get, run, transaction } = require('./base');
const { nowIso } = require('../lib/time');

// tourId = null → усі бронювання
exports.list = (tourId) => {
  const base = `SELECT bookings.*, tours.title AS tour_title
                FROM bookings JOIN tours ON bookings.tour_id = tours.id`;
  const order = 'ORDER BY datetime(bookings.created_at) DESC, bookings.id DESC';
  return tourId
    ? all(`${base} WHERE bookings.tour_id = ? ${order}`, [tourId])
    : all(`${base} ${order}`);
};

// Атомарне бронювання в одній транзакції:
//  1) ключ ідемпотентності вже використано → нічого не змінюємо (повтор форми);
//  2) UPDATE ... WHERE available_slots >= ? списує місця лише якщо їх вистачає
//     (перевірка і зміна — один оператор), changes = 0 → { booked: false };
//  3) INSERT бронювання. Будь-яка помилка → ROLLBACK (див. base.transaction).
// Дата створення ставиться тут у форматі ISO, а не передається ззовні.
exports.create = (b) =>
  transaction(async () => {
    if (b.idempotencyKey) {
      const existing = await get(
        'SELECT id FROM bookings WHERE idempotency_key = ?',
        [b.idempotencyKey]
      );
      if (existing) return { booked: true, duplicate: true, id: existing.id };
    }

    const updated = await run(
      `UPDATE tours SET available_slots = available_slots - ?
       WHERE id = ? AND available_slots >= ?`,
      [b.slots, b.tourId, b.slots]
    );
    if (updated.changes === 0) return { booked: false };

    const inserted = await run(
      `INSERT INTO bookings (tour_id, user_name, user_email, slots_booked, created_at, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        b.tourId,
        b.userName,
        b.userEmail,
        b.slots,
        nowIso(),
        b.idempotencyKey || null,
      ]
    );
    return { booked: true, duplicate: false, id: inserted.lastID };
  });
