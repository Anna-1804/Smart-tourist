const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validateMessage, main, TYPES } = require('../../scripts/check-commits');

describe('check-commits: validateMessage', () => {
  const good = [
    'feat: add health endpoint',
    'fix(booking): trim user name',
    'ci: add checks workflow',
    'docs: оновити spec',
    'refactor(db)!: split migrations',
    'chore: normalize line endings\n\nдовгий опис у тілі коміта',
    'Merge pull request #30 from Anna-1804/3lab_audit_fixes',
    "Merge branch 'main' into feature",
    'Revert "feat: add health endpoint"',
  ];
  for (const message of good) {
    test(`коректне: ${JSON.stringify(message.split('\n')[0])}`, () => {
      assert.equal(validateMessage(message), null);
    });
  }

  const bad = [
    ['fix stuff', /не відповідає формату/],
    ['видалено застарілі файли', /не відповідає формату/],
    ['spec.md_AI.md', /не відповідає формату/],
    ['Fix: capital type', /не відповідає формату/],
    ['feature: unknown type', /не відповідає формату/],
    ['fix:no space', /не відповідає формату/],
    ['fix: ', /не відповідає формату/],
    ['fix(): empty scope', /не відповідає формату/],
    ['', /порожнє/],
    ['   \n  ', /порожнє/],
    [`feat: ${'x'.repeat(100)}`, /довший/],
  ];
  for (const [message, pattern] of bad) {
    test(`некоректне: ${JSON.stringify(message.slice(0, 30))}`, () => {
      assert.match(validateMessage(message), pattern);
    });
  }

  test('усі дозволені типи приймаються', () => {
    for (const type of TYPES) {
      assert.equal(validateMessage(`${type}: опис`), null);
    }
  });
});

describe('check-commits: main', () => {
  const quiet = (fn) => {
    const original = console.error;
    const lines = [];
    console.error = (...args) => lines.push(args.join(' '));
    try {
      return { code: fn(), lines };
    } finally {
      console.error = original;
    }
  };
  const tmpFile = (text) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitmsg-'));
    const file = path.join(dir, 'MSG');
    fs.writeFileSync(file, text);
    return file;
  };

  test('--message-file: коректне повідомлення → 0 (рядки # ігноруються)', () => {
    const file = tmpFile('feat: add x\n# Please enter the commit message\n');
    const { code, lines } = quiet(() => main(['--message-file', file]));
    assert.equal(code, 0);
    assert.deepEqual(lines, []);
  });

  test('--message-file: некоректне повідомлення → 1 і пояснення', () => {
    const file = tmpFile('fix stuff\n');
    const { code, lines } = quiet(() => main(['--message-file', file]));
    assert.equal(code, 1);
    assert.match(lines[0], /fix stuff/);
  });

  test('без аргументів → 2 і підказка', () => {
    const { code, lines } = quiet(() => main([]));
    assert.equal(code, 2);
    assert.match(lines[0], /Використання/);
  });

  test('діапазон комітів у справжньому git-репозиторії: злиття пропускаються', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitrepo-'));
    const git = (...args) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=t',
          '-c',
          'user.email=t@t.t',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd: dir, encoding: 'utf8' }
      ).trim();
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'chore: base');
    const base = git('rev-parse', 'HEAD');
    git('commit', '-q', '--allow-empty', '-m', 'feat: good one');
    git('commit', '-q', '--allow-empty', '-m', 'fix stuff');
    const head = git('rev-parse', 'HEAD');

    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const bad = quiet(() => main([base, head]));
      assert.equal(bad.code, 1);
      assert.equal(bad.lines.length, 1);
      assert.match(bad.lines[0], /fix stuff/);

      git('commit', '-q', '--amend', '--allow-empty', '-m', 'fix: stuff');
      const ok = quiet(() => main([base, git('rev-parse', 'HEAD')]));
      assert.equal(ok.code, 0);

      // коміт злиття з "неправильною" назвою не перевіряється (його створює GitHub)
      git('checkout', '-q', '-b', 'side', base);
      git('commit', '-q', '--allow-empty', '-m', 'feat: side work');
      git('checkout', '-q', 'main');
      git('merge', '-q', '--no-ff', 'side', '-m', 'whatever merge title');
      const merged = quiet(() => main([base, git('rev-parse', 'HEAD')]));
      assert.equal(merged.code, 0);
    } finally {
      process.chdir(cwd);
    }
  });
});
