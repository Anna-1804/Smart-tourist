// Правило доступу береться із сервісного шару (services/access.js).
const { requireAdmin } = require('../services/access');

module.exports = (req, res, next) => {
  requireAdmin();
  next();
};
