// Створює контекст запиту: БД, користувач (роль) і ID бізнес-процесу.
const crypto = require('node:crypto');
const { getDatabase } = require('../database');
const { runWithContext } = require('../lib/context');
const logger = require('../lib/logger');

module.exports = (req, res, next) => {
  const role = req.headers['x-user-role'] || req.query.role || 'guest';
  const context = {
    db: getDatabase(), // ініціалізується явно на старті (database/index.js)
    user: { role },
    processId: crypto.randomUUID().slice(0, 8),
  };

  res.setHeader('X-Process-Id', context.processId);

  runWithContext(context, () => {
    logger.info(`--> ${req.method} ${req.originalUrl} (role=${role})`);
    res.on('finish', () => {
      // обробник події виконується поза ланцюжком запиту, тому відновлюємо контекст
      runWithContext(context, () =>
        logger.info(`<-- ${res.statusCode} ${req.method} ${req.originalUrl}`)
      );
    });
    next();
  });
};
