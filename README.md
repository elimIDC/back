# 엘림넷 가산 IDC 랙 배치도 — 백엔드

`front`(Next.js)에서 쓰는 랙 배치도 API 서버입니다. Express 5 + SQLite(better-sqlite3).

처음 실행하면 `src/seed.json`(기존 HTML 배치도에 들어 있던 13개 랙, 50대 장비)으로 DB를 채웁니다.

## 실행

```bash
npm install
cp .env.example .env   # 필요하면 값 수정
npm run dev            # 개발 (tsx watch)
```

운영:

```bash
npm run build
PORT=4000 DB_PATH=/var/lib/idc/idc.db API_TOKEN=change-me node dist/server.js
```

Docker:

```bash
docker build -t idc-rack-back .
docker run -d -p 4000:4000 -v idc-data:/data -e API_TOKEN=change-me idc-rack-back
```

## 환경 변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `4000` | 포트 |
| `DB_PATH` | `./data/idc.db` | SQLite 파일 경로 |
| `API_TOKEN` | (없음) | 설정하면 POST/PATCH/DELETE에 `Authorization: Bearer <토큰>` 필요 |
| `CORS_ORIGIN` | (없음) | 브라우저에서 직접 호출할 때 허용할 Origin, 쉼표 구분 |
| `TZ_NAME` | `Asia/Seoul` | 최종 수정일·변경 이력 날짜 기준 시간대 |

## 좌표 규칙

랙은 40U, 1U = 3칸 → `top`(시작 칸, 0~119), `h`(높이 칸 수). 가로는 3등분: `col`(0~2), `w`(1~3).

## API

모든 수정 API는 성공 시 전체 배치도(`GET /api/layout`과 같은 형식)를 돌려줍니다.
오류는 `{ "error": "메시지" }` 형식이며, 위치가 겹치거나 랙을 벗어나면 `409`입니다.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 상태 확인 |
| GET | `/api/layout` | 제목, 최종 수정일, 랙·장비 전체 |
| GET | `/api/logs?limit=500` | 변경 이력 (최신순, 최대 500건 보관) |
| PATCH | `/api/racks/:id` | 랙 정보 수정 `{tenant, tenantNote, status, door, noKey, checked, note}` (일부만 보내도 됨) |
| POST | `/api/racks/:id/devices` | 장비 반입 `{name, ip, note, top, h, col, w}` |
| PATCH | `/api/devices/:id` | 장비 수정·이동 `{name, ip, note, top, h, col, w, rackId?}` |
| DELETE | `/api/devices/:id` | 장비 반출 |

## 테스트

```bash
npm test
```
