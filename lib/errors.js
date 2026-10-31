// Прикладні помилки з HTTP-статусом. Сервісний шар кидає їх,
// а єдиний обробник у middleware/errorHandler.js перетворює на відповідь.
class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(400, message);
  }
}
class ForbiddenError extends AppError {
  constructor(message) {
    super(403, message);
  }
}
class NotFoundError extends AppError {
  constructor(message) {
    super(404, message);
  }
}
class ConflictError extends AppError {
  constructor(message) {
    super(409, message);
  }
}

module.exports = {
  AppError,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
};
