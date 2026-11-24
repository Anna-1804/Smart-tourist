const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const healthRepo = require('../../repositories/healthRepository');
const logger = require('../../lib/logger');
const healthService = require('../../services/healthService');

afterEach(() => mock.restoreAll());

describe('healthService.check', () => {
  test('крок schema виконано → ok, фонові кроки готовність не блокують', async () => {
    mock.method(healthRepo, 'listApplied', async () => [{ name: 'schema' }]);
    assert.deepEqual(await healthService.check(), {
      ok: true,
      applied: ['schema'],
    });
  });

  test('усі кроки виконано → ok зі списком кроків', async () => {
    mock.method(healthRepo, 'listApplied', async () => [
      { name: 'data' },
      { name: 'indexes' },
      { name: 'schema' },
    ]);
    const result = await healthService.check();
    assert.equal(result.ok, true);
    assert.deepEqual(result.applied, ['data', 'indexes', 'schema']);
  });

  test('кроку schema немає → не готовий (лише фонові кроки не рахуються)', async () => {
    mock.method(healthRepo, 'listApplied', async () => [{ name: 'data' }]);
    assert.deepEqual(await healthService.check(), {
      ok: false,
      reason: 'схема БД не готова',
      applied: ['data'],
    });
  });

  test('БД кидає помилку → не готовий, помилка потрапляє в лог', async () => {
    mock.method(healthRepo, 'listApplied', async () => {
      throw new Error('no such table: schema_migrations');
    });
    const lines = [];
    const restore = logger.setSink((level, line) => lines.push([level, line]));
    try {
      assert.deepEqual(await healthService.check(), {
        ok: false,
        reason: 'БД недоступна',
        applied: [],
      });
    } finally {
      restore();
    }
    assert.equal(lines[0][0], 'ERROR');
    assert.match(lines[0][1], /no such table/);
  });
});
