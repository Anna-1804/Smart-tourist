// Міграції окремими кроками: node scripts/migrate.js <schema|data|indexes|seed|all>
// Використовується в docker-entrypoint.sh: однаково на staging і prod.
const {
  openDatabase,
  prepareConnection,
  runMigrationStep,
  MIGRATION_STEPS,
} = require('../database');
const logger = require('../lib/logger');

async function migrate(step, filePath) {
  const names = step === 'all' ? MIGRATION_STEPS : [step];
  const unknown = names.find((name) => !MIGRATION_STEPS.includes(name));
  if (unknown) {
    throw new Error(
      `Невідомий крок міграції "${step}". Доступні: ${MIGRATION_STEPS.join(', ')}, all`
    );
  }
  const db = await openDatabase(filePath);
  try {
    // фонові кроки можуть довго чекати на блокування, тож таймаут більший, ніж у застосунку
    await prepareConnection(db, {
      busyTimeoutMs: Number(process.env.MIGRATE_BUSY_TIMEOUT_MS) || 60000,
    });
    for (const name of names) {
      await runMigrationStep(db, name);
    }
  } finally {
    await new Promise((resolve) => db.close(() => resolve()));
  }
}

if (require.main === module) {
  migrate(process.argv[2]).catch((err) => {
    logger.error(`Міграція не вдалася: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { migrate };
