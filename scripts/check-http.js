// Ручна перевірка запущеного застосунку: node scripts/check-http.js [http://localhost:3000]
// Запускайте після `npm start` в іншому терміналі. Змінює дані: створює бронювання.
const crypto = require('node:crypto');

const BASE = process.argv[2] || 'http://localhost:3000';
let failed = 0;

const check = (name, ok, details = '') => {
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${details ? ` (${details})` : ''}`
  );
};

const get = (path, role) =>
  fetch(BASE + path, { headers: role ? { 'x-user-role': role } : {} });

const book = (tourId, fields) =>
  fetch(`${BASE}/tours/${tourId}/book`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      user_name: 'Перевірка',
      user_email: 'check@example.com',
      slots_booked: '1',
      idempotency_key: crypto.randomUUID(),
      ...fields,
    }),
  });

const slotsOf = async (tourId) => {
  const html = await (await get(`/tours/${tourId}`)).text();
  const match = html.match(/Вільних місць:[^>]*>\s*(\d+)/);
  return match ? Number(match[1]) : NaN;
};

const countStatuses = (responses) =>
  responses.reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
    {}
  );

async function main() {
  check('GET / → 200', (await get('/')).status === 200);
  check('GET /tours/999 → 404', (await get('/tours/999')).status === 404);
  check('GET /admin без ролі → 403', (await get('/admin')).status === 403);
  check(
    'GET /admin з роллю admin → 200',
    (await get('/admin', 'admin')).status === 200
  );
  check(
    'GET /admin?role=admin&tour_id=abc → 400',
    (await get('/admin?role=admin&tour_id=abc', 'admin')).status === 400
  );

  check(
    'email без @ → 400',
    (await book(2, { user_email: 'bad' })).status === 400
  );
  check('0 місць → 400', (await book(2, { slots_booked: '0' })).status === 400);
  check(
    'дробова кількість → 400',
    (await book(2, { slots_booked: '1.5' })).status === 400
  );
  check('неіснуючий тур → 404', (await book(999, {})).status === 404);

  // Тур із найбільшою кількістю вільних місць (дані в БД можуть бути будь-які)
  const toursSlots = { 1: await slotsOf(1), 2: await slotsOf(2) };
  const tourId = toursSlots[1] >= toursSlots[2] ? 1 : 2;

  // Повторне надсилання форми з тим самим ключем
  const slotsBefore = await slotsOf(tourId);
  if (slotsBefore >= 1) {
    const key = crypto.randomUUID();
    for (let i = 0; i < 3; i += 1) await book(tourId, { idempotency_key: key });
    const slotsAfter = await slotsOf(tourId);
    check(
      'повтор форми з одним ключем списує місця один раз',
      slotsBefore - slotsAfter === 1,
      `тур ${tourId}: було ${slotsBefore}, стало ${slotsAfter}`
    );
  } else {
    check(
      'повтор форми з одним ключем',
      false,
      'немає вільних місць у турах 1 і 2: збільште їх в /admin'
    );
  }

  // Паралельні бронювання: успішних рівно стільки, скільки було місць
  const before = await slotsOf(tourId);
  if (!(before >= 1)) {
    check(
      'паралельні бронювання',
      false,
      'немає вільних місць: збільште їх в /admin і запустіть знову'
    );
    console.log(`\nПровалено перевірок: ${failed}`);
    process.exit(1);
  }
  const attempts = before + 3;
  const parallel = await Promise.all(
    Array.from({ length: attempts }, () => book(tourId, {}))
  );
  const stat = countStatuses(parallel);
  const after = await slotsOf(tourId);
  check(
    `паралельні бронювання: ${attempts} запитів на ${before} місць (тур ${tourId})`,
    (stat[200] || 0) === before &&
      (stat[409] || 0) === 3 &&
      !stat[500] &&
      after === 0,
    `статуси ${JSON.stringify(stat)}, місць після: ${after}`
  );

  console.log(
    failed ? `\nПровалено перевірок: ${failed}` : '\nУсі перевірки пройдено'
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(
    'Не вдалося виконати перевірку (сервер запущено?):',
    err.message
  );
  process.exit(1);
});
