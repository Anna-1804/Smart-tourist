// Єдиний обробник помилок: правильний HTTP-статус замість відповіді 200.
const logger = require('../lib/logger');

const TITLES = {
  400: '400 Bad Request',
  403: '403 Forbidden',
  404: '404 Not Found',
  409: '409 Conflict',
  500: '500 Internal Server Error',
};

 
module.exports = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const status = Number.isInteger(err.status) ? err.status : 500;

  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl}: ${err.stack || err}`);
  } else {
    logger.warn(`${req.method} ${req.originalUrl}: ${status} ${err.message}`);
  }

  const text =
    status >= 500
      ? 'Тимчасова несправність сервісу. Спробуйте пізніше.'
      : err.message;

  return res.status(status).render('error', {
    message: `${TITLES[status] || status}: ${text}`,
  });
};
