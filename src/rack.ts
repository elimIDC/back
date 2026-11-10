/**
 * 랙 좌표 규칙 (front와 동일)
 * - 랙 높이 40U, 1U = 3칸(slot) → 0~119 slot
 * - top: 시작 slot(0부터), h: 높이(slot 수)
 * - col: 가로 시작 위치(0~2), w: 가로 폭(1~3), 1 = 1/3 폭
 */
export const UNITS = 40;
export const SLOTS = UNITS * 3;
const SUB = ['위', '가운데', '아래'];

export type RackStatus = 'used' | 'empty' | 'leased';

export interface Device {
  id: string;
  name: string;
  ip: string;
  top: number;
  h: number;
  col: number;
  w: number;
  note: string;
}

export interface Rack {
  id: string;
  name: string;
  tenant: string;
  tenantNote: string;
  status: RackStatus;
  door: boolean;
  noKey: boolean;
  checked: string;
  note: string;
  devices: Device[];
}

export interface Layout {
  title: string;
  updated: string;
  racks: Rack[];
}

export interface LogEntry {
  id: number;
  at: string;
  text: string;
}

export type Box = Pick<Device, 'top' | 'h' | 'col' | 'w'>;

export const posText = (top: number) => `U${Math.floor(top / 3) + 1} ${SUB[top % 3]}칸`;
export const rangeText = (top: number, h: number) =>
  h <= 1 ? posText(top) : `${posText(top)} ~ ${posText(top + h - 1)}`;
export const sizeText = (h: number) => {
  const u = Math.floor(h / 3);
  const r = h % 3;
  if (!u) return `${r}칸`;
  return `${u}U${r ? ` ${r}칸` : ''}`;
};

export const overlaps = (a: Box, b: Box) =>
  a.top < b.top + b.h && b.top < a.top + a.h && a.col < b.col + b.w && b.col < a.col + a.w;

/** 위치가 랙 안에 들어가는지, 다른 장비와 겹치는지 검사. 문제가 없으면 null */
export function placementError(box: Box, others: Device[], selfId?: string): string | null {
  if (box.top < 0 || box.h < 1) return '위치와 높이를 확인해 주세요.';
  if (box.top + box.h > SLOTS) return '랙 아래로 넘칩니다. 40U 아래 칸까지만 쓸 수 있습니다.';
  if (box.col < 0 || box.w < 1 || box.col + box.w > 3) return '가로 위치가 랙 폭을 벗어납니다.';
  const hit = others.find((o) => o.id !== selfId && overlaps(box, o));
  if (hit) return `"${hit.name}"(${rangeText(hit.top, hit.h)})와 겹칩니다.`;
  return null;
}
