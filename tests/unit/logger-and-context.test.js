const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { runWithContext, getContext } = require('../../lib/context');
const logger = require('../../lib/logger');
const { nowIso } = require('../../lib/time');

const realEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = realEnv;
  mock.restoreAll();
});

describe('lib/context', () => {
  test('контекст видно всередині запиту, поза ним його немає', () => {
    assert.equal(getContext(), undefined);
    runWithContext({ processId: 'p1' }, () => {
      assert.equal(getContext().processId, 'p1');
    });
  });

  test('контекст зберігається через await', async () => {
    await runWithContext({ processId: 'p2' }, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(getContext().processId, 'p2');
    });
  });

  test('паралельні контексти не змішуються', async () => {
    const seen = await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        runWithContext({ processId: id }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5 - id.length));
          return getContext().processId;
        })
      )
    );
    assert.deepEqual(seen, ['a', 'b', 'c']);
  });
});

describe('lib/logger', () => {
  test('рядок містить рівень, ID процесу з контексту й повідомлення', () => {
    const lines = [];
    const restore = logger.setSink((level, line) => lines.push(line));
    runWithContext({ processId: 'zz99' }, () => logger.info('привіт'));
    restore();
    assert.match(lines[0], /\[INFO\] \[process=zz99\] привіт$/);
  });

  test('без контексту ID процесу = "-"', () => {
    const lines = [];
    const restore = logger.setSink((level, line) => lines.push(line));
    logger.warn('поза запитом');
    restore();
    assert.match(lines[0], /\[WARN\] \[process=-\] поза запитом$/);
  });

  test('restore повертає попередній приймач', () => {
    const first = [];
    const second = [];
    const restoreFirst = logger.setSink((l, line) => first.push(line));
    const restoreSecond = logger.setSink((l, line) => second.push(line));
    logger.info('a');
    restoreSecond();
    logger.info('b');
    restoreFirst();
    assert.equal(second.length, 1);
    assert.equal(first.length, 1);
  });

  test('NODE_ENV=test без приймача: нічого не виводиться', () => {
    process.env.NODE_ENV = 'test';
    const log = mock.method(console, 'log', () => {});
    const err = mock.method(console, 'error', () => {});
    logger.info('тихо');
    logger.error('тихо');
    assert.equal(log.mock.callCount() + err.mock.callCount(), 0);
  });

  test('поза test: INFO/WARN у console.log, ERROR у console.error', () => {
    process.env.NODE_ENV = 'production';
    const log = mock.method(console, 'log', () => {});
    const err = mock.method(console, 'error', () => {});
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    assert.equal(log.mock.callCount(), 2);
    assert.equal(err.mock.callCount(), 1);
  });
});

describe('lib/time.nowIso', () => {
  test('формат YYYY-MM-DD HH:MM:SS у UTC', () => {
    assert.match(nowIso(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
