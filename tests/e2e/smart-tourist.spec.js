const { test, expect } = require('@playwright/test');

// Зовнішні ресурси (Bootstrap CDN, картинки) не потрібні: без них тести стабільніші й швидші
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
});

const slotsOnDetails = async (page) =>
  Number(await page.locator('p:has-text("Вільних місць") .badge').innerText());

const bookingForm = (page) => page.locator('form[action$="/book"]');

const fillBooking = async (page, { name, email, slots }) => {
  const form = bookingForm(page);
  await form.locator('[name=user_name]').fill(name);
  await form.locator('[name=user_email]').fill(email);
  await form.locator('[name=slots_booked]').fill(String(slots));
  return form;
};

const submitAndWait = async (page, form) => {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    form.locator('button[type=submit]').click(),
  ]);
  return response;
};

test.describe('Сценарії користувача', () => {
  test('1.1 пошук екскурсій за містом', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.card-title')).toHaveCount(2);

    await page.selectOption('select[name=city_id]', { label: 'Київ' });
    await page.getByRole('button', { name: 'Пошук' }).click();

    await expect(page.locator('.card-title')).toHaveText([
      'Таємниці Старого Києва',
    ]);
  });

  test('1.2 перегляд деталей екскурсії', async ({ page }) => {
    await page.goto('/');
    await page
      .locator('.card', { hasText: 'Замки Львівщини' })
      .getByRole('link', { name: 'Детальніше' })
      .click();

    await expect(page).toHaveURL(/\/tours\/1$/);
    await expect(page.locator('h2')).toContainText('Замки Львівщини');
    await expect(page.locator('body')).toContainText('Олеський замок');
  });

  test('1.3 успішне бронювання зменшує кількість місць', async ({ page }) => {
    await page.goto('/tours/2');
    const before = await slotsOnDetails(page);

    const form = await fillBooking(page, {
      name: 'Іван',
      email: 'ivan@example.com',
      slots: 2,
    });
    const response = await submitAndWait(page, form);

    expect(response.status()).toBe(200);
    await expect(page.locator('.alert-success')).toContainText(
      'Місця успішно заброньовані!'
    );
    expect(await slotsOnDetails(page)).toBe(before - 2);
  });

  test('1.3 бронювання більше за доступні місця → 409', async ({ page }) => {
    await page.goto('/tours/2');
    const before = await slotsOnDetails(page);

    const form = await fillBooking(page, {
      name: 'Петро',
      email: 'petro@example.com',
      slots: 999,
    });
    const response = await submitAndWait(page, form);

    expect(response.status()).toBe(409);
    await expect(page.locator('.alert-danger')).toContainText('доступно лише');
    expect(await slotsOnDetails(page)).toBe(before);
  });

  test('1.3 повторне надсилання форми не створює друге бронювання', async ({
    page,
  }) => {
    await page.goto('/tours/2');
    const before = await slotsOnDetails(page);
    const key = await page.locator('input[name=idempotency_key]').inputValue();
    const data = {
      user_name: 'Марія',
      user_email: 'maria@example.com',
      slots_booked: '1',
      idempotency_key: key,
    };

    const first = await page.request.post('/tours/2/book', { form: data });
    const second = await page.request.post('/tours/2/book', { form: data });

    expect(first.status()).toBe(200);
    expect(await second.text()).toContain('вже було оформлено раніше');

    await page.goto('/tours/2');
    expect(await slotsOnDetails(page)).toBe(before - 1);
  });

  test('1.4 залишення відгуку', async ({ page }) => {
    const comment = `Відгук E2E ${Date.now()}`;
    await page.goto('/tours/1');

    const form = page.locator('form[action$="/reviews"]');
    await form.locator('[name=user_name]').fill('Оксана');
    await form.locator('[name=rating]').selectOption('4');
    await form.locator('[name=comment]').fill(comment);
    await form.locator('button[type=submit]').click();

    await expect(page.locator('.alert-success')).toContainText(
      'Ваш відгук оприлюднено'
    );
    const review = page.locator('div.border.rounded', { hasText: comment });
    await expect(review).toContainText('Оксана');
    await expect(review).toContainText('4/5');
  });

  test('неіснуюча екскурсія → 404', async ({ page }) => {
    const response = await page.goto('/tours/9999');
    expect(response.status()).toBe(404);
    await expect(page.locator('body')).toContainText('404 Not Found');
  });
});

test.describe('Сценарії адміністратора', () => {
  test('гість не потрапляє в адмін-панель → 403', async ({ page }) => {
    const response = await page.goto('/admin');
    expect(response.status()).toBe(403);
    await expect(page.locator('body')).toContainText('403 Forbidden');
  });

  test('2.1 + 1.1 адмін створює тур, гість бачить його в каталозі', async ({
    page,
  }) => {
    const title = `Тур E2E ${Date.now()}`;

    await page.goto('/');
    await page.getByRole('link', { name: 'Адмін-панель' }).click();
    await expect(page.locator('h2')).toContainText('Панель Управління');

    const form = page.locator('form[action^="/admin/tours?"]');
    await form.locator('[name=city_id]').selectOption({ label: 'Київ' });
    await form.locator('[name=title]').fill(title);
    await form.locator('[name=price]').fill('300');
    await form.locator('[name=available_slots]').fill('0');
    await form.locator('button[type=submit]').click();

    await expect(page.locator('.alert-success')).toContainText(
      'Нову екскурсію успішно додано'
    );

    // тур без місць: у каталозі він є, а кнопка бронювання вимкнена
    await page.goto('/');
    await page
      .locator('.card', { hasText: title })
      .getByRole('link', { name: 'Детальніше' })
      .click();
    await expect(page.locator('form[action$="/book"] button')).toBeDisabled();
    await expect(page.locator('form[action$="/book"] button')).toHaveText(
      /Місць немає/
    );
  });

  test('2.2 адмін змінює ціну туру', async ({ page }) => {
    await page.goto('/admin?role=admin');
    const form = page.locator('form[action^="/admin/tours/1/update"]');
    await form.locator('[name=price]').fill('999');
    await form.locator('button[type=submit]').click();

    await expect(page.locator('.alert-success')).toContainText(
      'Параметри екскурсії оновлено'
    );

    await page.goto('/tours/1');
    await expect(page.locator('body')).toContainText('999 грн / особа');
  });

  test('2.3 + 2.4 фільтр бронювань і відгуків за туром', async ({ page }) => {
    // створюємо бронювання на турі 2
    await page.goto('/tours/2');
    const form = await fillBooking(page, {
      name: 'Фільтр',
      email: 'filter-e2e@example.com',
      slots: 1,
    });
    await form.locator('button[type=submit]').click();
    await expect(page.locator('.alert-success')).toBeVisible();

    // адмін фільтрує за туром 2, потім за туром 1
    await page.goto('/admin?role=admin');
    const filter = page.locator('form[action="/admin"][method="GET"]');
    await filter.locator('select[name=tour_id]').selectOption('2');
    await filter.getByRole('button', { name: 'Фільтрувати' }).click();
    await expect(page).toHaveURL(/tour_id=2/);
    await expect(page.locator('table')).toContainText('filter-e2e@example.com');

    await page.locator('select[name=tour_id]').selectOption('1');
    await page.getByRole('button', { name: 'Фільтрувати' }).click();
    await expect(page.locator('table')).not.toContainText(
      'filter-e2e@example.com'
    );
  });
});
