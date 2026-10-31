// Правила доступу. Користувач береться з контексту запиту.
const { getContext } = require('../lib/context');
const { ForbiddenError } = require('../lib/errors');
const logger = require('../lib/logger');

exports.requireAdmin = () => {
  const context = getContext();
  if (!context || !context.user || context.user.role !== 'admin') {
    logger.warn('доступ до адмін-функцій заборонено');
    throw new ForbiddenError(
      'Порушення прав доступу. Потрібні права адміністратора.'
    );
  }
};
