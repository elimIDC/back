import { config } from './config.js';
import { openDb } from './db.js';
import { createService } from './service.js';
import { createApp } from './app.js';

const db = openDb(config.dbPath);
const app = createApp(createService(db, config.timeZone), {
  apiToken: config.apiToken,
  corsOrigins: config.corsOrigins,
});

const server = app.listen(config.port, () => {
  console.log(`IDC rack API listening on :${config.port} (db: ${config.dbPath})`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
