const { all } = require('./base');

// Які кроки міграцій уже виконано (журнал schema_migrations)
exports.listApplied = () =>
  all('SELECT name FROM schema_migrations ORDER BY name');
