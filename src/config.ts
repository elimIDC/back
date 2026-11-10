import path from 'node:path';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  dbPath: path.resolve(process.env.DB_PATH ?? './data/idc.db'),
  apiToken: process.env.API_TOKEN?.trim() || '',
  corsOrigins: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  timeZone: process.env.TZ_NAME?.trim() || 'Asia/Seoul',
};
