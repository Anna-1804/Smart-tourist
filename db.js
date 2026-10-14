// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Помилка відкриття БД:', err.message);
  } else {
    console.log('Підключено до локальної бази даних SQLite.');
  }
});

// Увімкнення підтримки зовнішніх ключів (Foreign Keys)
db.run("PRAGMA foreign_keys = ON;");

// Ініціалізація та наповнення таблиць початковими даними у транзакції
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS cities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    city_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    program TEXT,
    price NUMERIC NOT NULL,
    available_slots INTEGER NOT NULL,
    image_url TEXT,
    FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tour_id INTEGER,
    user_name TEXT NOT NULL,
    user_email TEXT NOT NULL,
    slots_booked INTEGER NOT NULL,
    created_at TEXT,
    FOREIGN KEY (tour_id) REFERENCES tours(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tour_id INTEGER,
    user_name TEXT NOT NULL,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TEXT,
    FOREIGN KEY (tour_id) REFERENCES tours(id) ON DELETE CASCADE
  )`, () => {
    // Перевірка наявності даних та заповнення всередині транзакції
    db.get(`SELECT COUNT(*) as count FROM cities`, (err, row) => {
      if (!err && row && row.count === 0) {
        console.log('Заповнення бази початковими даними...');
        
        db.serialize(() => {
          db.run("BEGIN TRANSACTION;");

          db.run(`INSERT INTO cities (id, name, description) VALUES (1, 'Львів', 'Культурна столиця України.')`);
          db.run(`INSERT INTO cities (id, name, description) VALUES (2, 'Київ', 'Столиця України з багатою історією.')`);

          db.run(`INSERT INTO tours (id, city_id, title, description, program, price, available_slots, image_url) VALUES 
            (1, 1, 'Замки Львівщини', 'Екскурсія найвідомішими замками регіону.', '1. Виїзд зі Львова. 2. Олеський замок. 3. Підгорецький замок.', 850, 5, 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTcraSpYriXJGvhaLLVOJC0zv5n7xTMwhwfJMb5_uI64c9ODTUBo3CfQTk&s=10')`);
          
          db.run(`INSERT INTO tours (id, city_id, title, description, program, price, available_slots, image_url) VALUES 
            (2, 2, 'Таємниці Старого Києва', 'Пішохідна прогулянка історичним центром.', '1. Золоті Ворота. 2. Софійський собор. 3. Андріївський узвіз.', 500, 10, 'https://tickikids.ams3.cdn.digitaloceanspaces.com/z1.cache/gallery/activities/9689/image_5aa55395b13a85.56890693.jpg')`);

          db.run(`INSERT INTO reviews (tour_id, user_name, rating, comment, created_at) VALUES 
            (1, 'Олена', 5, 'Чудова екскурсія! Гід просто супер.', datetime('now'))`);

          db.run("COMMIT;", (commitErr) => {
            if (commitErr) {
              console.error("Помилка підтвердження транзакції:", commitErr);
            } else {
              console.log("Початкові дані успішно записано в базу.");
            }
          });
        });
      }
    });
  });
});

module.exports = db;