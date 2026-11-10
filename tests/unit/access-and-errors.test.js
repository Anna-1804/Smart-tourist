const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { runWithContext } = require('../../lib/context');
const errors = require('../../lib/errors');
const logger = require('../../lib/logger');
const { requireAdmin } = require('../../services/access');
const requireAdminMiddleware = require('../../middleware/requireAdmin');

afterEach(() => mock.restoreAll());

describe('lib/errors', () => {
  const table = [
    ['ValidationError', 400],
    ['ForbiddenError', 403],
    ['NotFoundError', 404],
    ['ConflictError', 409],
  ];
  for (const [name, status] of table) {
    test(`${name} має статус ${status}, назву класу й успадковує AppError`, () => {
      const err = new errors[name]('текст');
      assert.equal(err.status, status);
      assert.equal(err.name, name);
      assert.equal(err.message, 'текст');
      assert.ok(err instanceof errors.AppError);
      assert.ok(err instanceof Error);
    });
  }
});

describe('services/access.requireAdmin', () => {
  const as = (context, fn) => runWithContext(context, fn);

  test('роль admin: доступ дозволено', () => {
    as({ user: { role: 'admin' } }, () => assert.doesNotThrow(requireAdmin));
  });

  const denied = [
    ['гість', { user: { role: 'guest' } }],
    ['контекст без користувача', {}],
  ];
  for (const [title, context] of denied) {
    test(`${title}: 403`, () => {
      as(context, () =>
        assert.throws(requireAdmin, (err) => err.status === 403)
      );
    });
  }

  test('поза запитом (без контексту): 403', () => {
    assert.throws(requireAdmin, (err) => err.status === 403);
  });

  test('відмова містить зрозуміле повідомлення про права', () => {
    as({ user: { role: 'guest' } }, () =>
      assert.throws(requireAdmin, (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /Потрібні права адміністратора/);
        return true;
      })
    );
  });

  test('відмова записується в лог із ID процесу', () => {
    const lines = [];
    const restore = logger.setSink((level, line) => lines.push([level, line]));
    try {
      as({ user: { role: 'guest' }, processId: 'abc12345' }, () =>
        assert.throws(requireAdmin)
      );
    } finally {
      restore();
    }
    assert.equal(lines[0][0], 'WARN');
    assert.match(lines[0][1], /\[process=abc12345\]/);
  });
});

describe('middleware/requireAdmin', () => {
  test('адмін: викликається next()', () => {
    const next = mock.fn();
    runWithContext({ user: { role: 'admin' } }, () =>
      requireAdminMiddleware({}, {}, next)
    );
    assert.equal(next.mock.callCount(), 1);
  });

  test('не адмін: кидає 403, next() не викликається', () => {
    const next = mock.fn();
    runWithContext({ user: { role: 'guest' } }, () =>
      assert.throws(
        () => requireAdminMiddleware({}, {}, next),
        (err) => err.status === 403
      )
    );
    assert.equal(next.mock.callCount(), 0);
  });
});
