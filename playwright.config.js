const { defineConfig } = require('@playwright/test');

const PORT = 3100;

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js', // не *.test.js, щоб node --test їх не підхопив
  fullyParallel: false,
  workers: 1, // один сервер і одна БД на весь прогін
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/start-server.js',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
