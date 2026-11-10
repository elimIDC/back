import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import {
  placementError,
  rangeText,
  sizeText,
  type Device,
  type Layout,
  type LogEntry,
  type Rack,
  type RackStatus,
} from './rack.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface DeviceInput {
  name: string;
  ip: string;
  note: string;
  top: number;
  h: number;
  col: number;
  w: number;
}

export interface RackPatch {
  tenant?: string;
  tenantNote?: string;
  status?: RackStatus;
  door?: boolean;
  noKey?: boolean;
  checked?: string;
  note?: string;
}

interface RackRow {
  id: string;
  name: string;
  tenant: string;
  tenant_note: string;
  status: RackStatus;
  door: number;
  no_key: number;
  checked: string;
  note: string;
}
type DeviceRow = Device & { rack_id: string };

const LOG_LIMIT = 500;

export function createService(db: DB, timeZone: string) {
  const today = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  const q = {
    meta: db.prepare('SELECT key, value FROM meta'),
    racks: db.prepare('SELECT * FROM racks ORDER BY sort_order, id'),
    rack: db.prepare('SELECT * FROM racks WHERE id = ?'),
    devices: db.prepare('SELECT * FROM devices ORDER BY top, col'),
    rackDevices: db.prepare('SELECT * FROM devices WHERE rack_id = ?'),
    device: db.prepare('SELECT * FROM devices WHERE id = ?'),
    insDevice: db.prepare(`INSERT INTO devices(id, rack_id, name, ip, top, h, col, w, note)
      VALUES (@id, @rackId, @name, @ip, @top, @h, @col, @w, @note)`),
    updDevice: db.prepare(`UPDATE devices SET rack_id=@rackId, name=@name, ip=@ip, top=@top, h=@h, col=@col, w=@w, note=@note
      WHERE id=@id`),
    delDevice: db.prepare('DELETE FROM devices WHERE id = ?'),
    updRack: db.prepare(`UPDATE racks SET tenant=@tenant, tenant_note=@tenantNote, status=@status, door=@door,
      no_key=@noKey, checked=@checked, note=@note WHERE id=@id`),
    setUsed: db.prepare(`UPDATE racks SET status='used' WHERE id = ? AND status = 'empty'`),
    setMeta: db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)'),
    insLog: db.prepare('INSERT INTO logs(at, text) VALUES (?, ?)'),
    trimLogs: db.prepare(`DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT ${LOG_LIMIT})`),
    logs: db.prepare('SELECT id, at, text FROM logs ORDER BY id DESC LIMIT ?'),
  };

  const toDevice = (r: DeviceRow): Device => ({
    id: r.id, name: r.name, ip: r.ip, top: r.top, h: r.h, col: r.col, w: r.w, note: r.note,
  });
  const toRack = (r: RackRow, devices: Device[]): Rack => ({
    id: r.id, name: r.name, tenant: r.tenant, tenantNote: r.tenant_note, status: r.status,
    door: !!r.door, noKey: !!r.no_key, checked: r.checked, note: r.note, devices,
  });

  function getRackRow(id: string) {
    const r = q.rack.get(id) as RackRow | undefined;
    if (!r) throw new HttpError(404, `랙 "${id}"을(를) 찾을 수 없습니다.`);
    return r;
  }
  function getDeviceRow(id: string) {
    const d = q.device.get(id) as DeviceRow | undefined;
    if (!d) throw new HttpError(404, '장비를 찾을 수 없습니다. 다른 사람이 먼저 반출했을 수 있습니다.');
    return d;
  }
  function checkPlacement(rackId: string, box: DeviceInput, selfId?: string) {
    const others = (q.rackDevices.all(rackId) as DeviceRow[]).map(toDevice);
    const err = placementError(box, others, selfId);
    if (err) throw new HttpError(409, err);
  }
  function touch(text: string) {
    const d = today();
    q.insLog.run(d, text);
    q.trimLogs.run();
    q.setMeta.run('updated', d);
  }

  function getLayout(): Layout {
    const meta = Object.fromEntries((q.meta.all() as { key: string; value: string }[]).map((m) => [m.key, m.value]));
    const byRack = new Map<string, Device[]>();
    for (const d of q.devices.all() as DeviceRow[]) {
      if (!byRack.has(d.rack_id)) byRack.set(d.rack_id, []);
      byRack.get(d.rack_id)!.push(toDevice(d));
    }
    return {
      title: meta.title ?? 'IDC 랙 배치도',
      updated: meta.updated ?? '',
      racks: (q.racks.all() as RackRow[]).map((r) => toRack(r, byRack.get(r.id) ?? [])),
    };
  }

  const createDevice = db.transaction((rackId: string, input: DeviceInput): Device => {
    const rack = getRackRow(rackId);
    checkPlacement(rackId, input);
    const dev: Device = { id: 'd' + randomUUID().replace(/-/g, '').slice(0, 12), ...input };
    q.insDevice.run({ ...dev, rackId });
    q.setUsed.run(rackId);
    touch(`${dev.name}${dev.ip ? ` (${dev.ip})` : ''} 반입, ${rack.name} ${rangeText(dev.top, dev.h)} (${sizeText(dev.h)})`);
    return dev;
  });

  const updateDevice = db.transaction((id: string, input: DeviceInput & { rackId?: string }): Device => {
    const cur = getDeviceRow(id);
    const fromRack = getRackRow(cur.rack_id);
    const toRackId = input.rackId ?? cur.rack_id;
    const target = toRackId === cur.rack_id ? fromRack : getRackRow(toRackId);
    checkPlacement(toRackId, input, id);
    const dev: Device = { id, name: input.name, ip: input.ip, note: input.note, top: input.top, h: input.h, col: input.col, w: input.w };
    q.updDevice.run({ ...dev, rackId: toRackId });
    q.setUsed.run(toRackId);
    const before = `${fromRack.name} ${rangeText(cur.top, cur.h)}`;
    const where = `${target.name} ${rangeText(dev.top, dev.h)}`;
    touch(`${dev.name} 수정${before !== where ? `, ${before} → ${where}` : ''}`);
    return dev;
  });

  const deleteDevice = db.transaction((id: string) => {
    const cur = getDeviceRow(id);
    const rack = getRackRow(cur.rack_id);
    q.delDevice.run(id);
    touch(`${rack.name} ${cur.name}${cur.ip ? ` (${cur.ip})` : ''} 반출, ${rangeText(cur.top, cur.h)} 비움`);
  });

  const updateRack = db.transaction((id: string, patch: RackPatch): Rack => {
    const r = getRackRow(id);
    const next = {
      id,
      tenant: patch.tenant ?? r.tenant,
      tenantNote: patch.tenantNote ?? r.tenant_note,
      status: patch.status ?? r.status,
      door: (patch.door ?? !!r.door) ? 1 : 0,
      noKey: (patch.noKey ?? !!r.no_key) ? 1 : 0,
      checked: patch.checked ?? r.checked,
      note: patch.note ?? r.note,
    };
    q.updRack.run(next);
    touch(`${r.name} 랙 정보 수정`);
    const row = getRackRow(id);
    return toRack(row, (q.rackDevices.all(id) as DeviceRow[]).map(toDevice));
  });

  function getLogs(limit = LOG_LIMIT): LogEntry[] {
    return q.logs.all(Math.min(Math.max(1, limit), LOG_LIMIT)) as LogEntry[];
  }

  return { getLayout, createDevice, updateDevice, deleteDevice, updateRack, getLogs };
}

export type Service = ReturnType<typeof createService>;
