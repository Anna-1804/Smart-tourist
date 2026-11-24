// Перевірка повідомлень комітів за Conventional Commits, без залежностей.
//   node scripts/check-commits.js --message-file .git/COMMIT_EDITMSG   (хук commit-msg)
//   node scripts/check-commits.js <від> <до>                            (CI, коміти PR)
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];
const MAX_HEADER = 100;
const HEADER = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9._/-]+\\))?!?: \\S`);

// Повертає текст помилки або null, якщо повідомлення коректне
function validateMessage(message) {
  const header = String(message).split('\n')[0].trim();
  if (header === '') return 'порожнє повідомлення коміта';
  // службові коміти git: злиття і відкат
  if (/^(Merge|Revert) /.test(header)) return null;
  if (header.length > MAX_HEADER) {
    return `заголовок довший за ${MAX_HEADER} символів`;
  }
  if (!HEADER.test(header)) {
    return `"${header}" не відповідає формату type(scope): опис (type: ${TYPES.join(', ')})`;
  }
  return null;
}

function commitsBetween(from, to) {
  const out = execFileSync(
    'git',
    ['log', '--no-merges', '--format=%h%x09%s', `${from}..${to}`],
    { encoding: 'utf8' }
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, ...subject] = line.split('\t');
      return { hash, subject: subject.join('\t') };
    });
}

function main(argv) {
  let problems = [];
  if (argv[0] === '--message-file') {
    const text = fs
      .readFileSync(argv[1], 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n');
    const error = validateMessage(text);
    if (error) problems = [{ hash: 'commit', error }];
  } else if (argv.length === 2) {
    for (const { hash, subject } of commitsBetween(argv[0], argv[1])) {
      const error = validateMessage(subject);
      if (error) problems.push({ hash, error });
    }
  } else {
    console.error(
      'Використання: check-commits.js <від> <до> | --message-file <файл>'
    );
    return 2;
  }
  for (const { hash, error } of problems) console.error(`✖ ${hash}: ${error}`);
  return problems.length === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { validateMessage, main, TYPES };
