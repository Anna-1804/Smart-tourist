// Час у БД зберігається у форматі ISO 'YYYY-MM-DD HH:MM:SS' (UTC):
// його розуміє datetime() і за ним коректно працює ORDER BY.
exports.nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
