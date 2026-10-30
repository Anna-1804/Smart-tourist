// Контекст запиту: БД, користувач і ID бізнес-процесу.
// AsyncLocalStorage зберігає його для всього ланцюжка викликів одного запиту,
// тому сервіси й репозиторії не отримують db/user/ID параметрами.
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

const runWithContext = (context, callback) => storage.run(context, callback);
const getContext = () => storage.getStore();

module.exports = { runWithContext, getContext };
