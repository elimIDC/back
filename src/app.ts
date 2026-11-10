import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { SLOTS } from './rack.js';
import { HttpError, type Service } from './service.js';

const str = (max: number) => z.string().trim().max(max);
const ipField = str(64).refine((v) => v === '' || /^[0-9a-fA-F.:/ ]+$/.test(v), 'IP 형식이 올바르지 않습니다.');

const deviceSchema = z
  .object({
    name: str(120).min(1, '장비명을 입력해 주세요.'),
    ip: ipField.default(''),
    note: str(500).default(''),
    top: z.number().int().min(0).max(SLOTS - 1),
    h: z.number().int().min(1).max(SLOTS),
    col: z.number().int().min(0).max(2).default(0),
    w: z.number().int().min(1).max(3).default(3),
  })
  .refine((d) => d.col + d.w <= 3, { message: '가로 위치가 랙 폭을 벗어납니다.', path: ['w'] });

const deviceUpdateSchema = deviceSchema.and(z.object({ rackId: str(40).min(1).optional() }));

const rackPatchSchema = z
  .object({
    tenant: str(120),
    tenantNote: str(120),
    status: z.enum(['used', 'empty', 'leased']),
    door: z.boolean(),
    noKey: z.boolean(),
    checked: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식은 YYYY-MM-DD 입니다.')]),
    note: str(500),
  })
  .partial()
  .strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? '요청 형식이 올바르지 않습니다.');
  return r.data;
}

export interface AppOptions {
  apiToken?: string;
  corsOrigins?: string[];
}

export function createApp(svc: Service, opts: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  if (opts.corsOrigins?.length) app.use(cors({ origin: opts.corsOrigins }));
  app.use(express.json({ limit: '100kb' }));

  // 쓰기 요청은 API_TOKEN이 설정돼 있을 때만 토큰 검사
  const requireWrite = (req: Request, _res: Response, next: NextFunction) => {
    if (!opts.apiToken) return next();
    const auth = req.get('authorization') ?? '';
    if (auth === `Bearer ${opts.apiToken}`) return next();
    next(new HttpError(auth ? 403 : 401, '수정 권한이 없습니다.'));
  };

  const api = express.Router();

  api.get('/health', (_req, res) => { res.json({ ok: true }); });

  api.get('/layout', (_req, res) => { res.json(svc.getLayout()); });

  api.get('/logs', (req, res) => {
    const limit = Number(req.query.limit ?? 500) || 500;
    res.json(svc.getLogs(limit));
  });

  api.patch('/racks/:id', requireWrite, (req, res) => {
    svc.updateRack(String(req.params.id), parse(rackPatchSchema, req.body));
    res.json(svc.getLayout());
  });

  api.post('/racks/:id/devices', requireWrite, (req, res) => {
    svc.createDevice(String(req.params.id), parse(deviceSchema, req.body));
    res.status(201).json(svc.getLayout());
  });

  api.patch('/devices/:id', requireWrite, (req, res) => {
    svc.updateDevice(String(req.params.id), parse(deviceUpdateSchema, req.body));
    res.json(svc.getLayout());
  });

  api.delete('/devices/:id', requireWrite, (req, res) => {
    svc.deleteDevice(String(req.params.id));
    res.json(svc.getLayout());
  });

  app.use('/api', api);

  app.use((_req, _res, next) => next(new HttpError(404, '없는 경로입니다.')));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON 형식이 올바르지 않습니다.' });
    }
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });

  return app;
}
