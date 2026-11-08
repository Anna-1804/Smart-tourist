const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const logger = require('../../lib/logger');
const errorHandler = require('../../middleware/errorHandler');

const req = { method: 'GET', originalUrl: '/x' };

const fakeRes = (headersSent = false) => {
  const res = { headersSent, statusCode: null, view: null, model: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.render = (view, model) => {
    res.view = view;
    res.model = model;
    return res;
  };
  return res;
};

let lines;
let restore;
beforeEach(() => {
  lines = [];
  restore = logger.setSink((level, line) => lines.push({ level, line }));
});
afterEach(() => {
  restore();
  mock.restoreAll();
});

describe('middleware/errorHandler', () => {
  const known = [
    [400, '400 Bad Request'],
    [403, '403 Forbidden'],
    [404, '404 Not Found'],
    [409, '409 Conflict'],
  ];
  for (const [status, title] of known) {
    test(`${status}: правильний статус і текст помилки, лог WARN`, () => {
      const res = fakeRes();
      errorHandler({ status, message: 'пояснення' }, req, res, mock.fn());
      assert.equal(res.statusCode, status);
      assert.equal(res.view, 'error');
      assert.equal(res.model.message, `${title}: пояснення`);
      assert.equal(lines[0].level, 'WARN');
    });
  }

  test('невідомий 4xx-статус показується числом', () => {
    const res = fakeRes();
    errorHandler({ status: 418, message: 'чайник' }, req, res, mock.fn());
    assert.equal(res.statusCode, 418);
    assert.equal(res.model.message, '418: чайник');
  });

  test('500 не розкриває внутрішніх деталей, лог ERROR зі стеком', () => {
    const res = fakeRes();
    const err = new Error('SQLITE_CANTOPEN: /secret/path.db');
    errorHandler(err, req, res, mock.fn());
    assert.equal(res.statusCode, 500);
    assert.match(res.model.message, /^500 Internal Server Error: Тимчасова/);
    assert.ok(!res.model.message.includes('secret'));
    assert.equal(lines[0].level, 'ERROR');
    assert.match(lines[0].line, /secret/);
  });

  test('помилка без status і не-ціле status → 500', () => {
    for (const err of [new Error('x'), { status: '404', message: 'y' }]) {
      const res = fakeRes();
      errorHandler(err, req, res, mock.fn());
      assert.equal(res.statusCode, 500);
    }
  });

  test('помилка без стеку логується як є (рядок)', () => {
    errorHandler('просто рядок', req, fakeRes(), mock.fn());
    assert.match(lines[0].line, /просто рядок/);
  });

  test('відповідь уже почато: помилка передається далі в next', () => {
    const res = fakeRes(true);
    const next = mock.fn();
    const err = new Error('пізно');
    errorHandler(err, req, res, next);
    assert.deepEqual(next.mock.calls[0].arguments, [err]);
    assert.equal(res.view, null);
  });
});
