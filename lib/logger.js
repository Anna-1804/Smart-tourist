// Логер: кожен рядок отримує ID бізнес-процесу з контексту запиту.
const { getContext } = require('./context');

const write = (level, message) => {
  if (process.env.NODE_ENV === 'test') return;
  const context = getContext();
  const processId = context ? context.processId : '-';
  const line = `${new Date().toISOString()} [${level}] [process=${processId}] ${message}`;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
};

module.exports = {
  info: (message) => write('INFO', message),
  warn: (message) => write('WARN', message),
  error: (message) => write('ERROR', message),
};
