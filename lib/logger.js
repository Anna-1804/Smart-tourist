// Логер: кожен рядок отримує ID бізнес-процесу з контексту запиту.
const { getContext } = require('./context');

let sink = null; // для тестів: перехоплення рядків

const setSink = (fn) => {
  const previous = sink;
  sink = fn;
  return () => {
    sink = previous;
  };
};

const write = (level, message) => {
  const context = getContext();
  const processId = context ? context.processId : '-';
  const line = `${new Date().toISOString()} [${level}] [process=${processId}] ${message}`;
  if (sink) return sink(level, line);
  if (process.env.NODE_ENV === 'test') return undefined;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  return undefined;
};

module.exports = {
  info: (message) => write('INFO', message),
  warn: (message) => write('WARN', message),
  error: (message) => write('ERROR', message),
  setSink,
};
