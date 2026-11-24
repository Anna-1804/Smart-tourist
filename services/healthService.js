const healthRepo = require('../repositories/healthRepository');
const logger = require('../lib/logger');

// Готовність до трафіку: БД відповідає і крок міграцій "schema" виконано.
// Індекси й оновлення даних працюють у фоні й готовність не блокують.
exports.check = async () => {
  try {
    const applied = (await healthRepo.listApplied()).map((row) => row.name);
    if (!applied.includes('schema')) {
      return { ok: false, reason: 'схема БД не готова', applied };
    }
    return { ok: true, applied };
  } catch (err) {
    logger.error(`/health: ${err.message}`);
    return { ok: false, reason: 'БД недоступна', applied: [] };
  }
};
