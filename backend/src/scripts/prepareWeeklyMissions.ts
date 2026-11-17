import path from 'path';
import dotenv from 'dotenv';

// Run once during deployment, before replacing the serving API processes.
// This prevents request handlers from competing to create the initial schema.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.api'), override: true });

const main = async () => {
  const db = await import('../services/db');
  await db.initDatabaseConnection({ runCompatibilityMigrations: false });
  try {
    const { ensureAchievementTables } = await import('../services/achievementService');
    const { ensureWeeklyMissionTables } = await import('../services/weeklyMissionSchema');
    await ensureAchievementTables();
    await ensureWeeklyMissionTables();
    console.log('[deploy] weekly mission schema is ready');
  } finally {
    if (db.getDbMode() === 'MYSQL') await db.getMysqlDb().close();
    if (db.getDbMode() === 'LOCAL_SQL') db.getSqliteDb().close();
  }
};

main().catch((error) => {
  console.error('[deploy] weekly mission schema preparation failed:', error?.message || error);
  process.exitCode = 1;
});
