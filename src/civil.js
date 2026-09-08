// 벽시계(civil) 시각 계산 헬퍼.
//
// Asia/Seoul은 DST가 없으므로 고정 오프셋(+09:00)으로 epoch <-> 벽시계 변환이 안전하다.
// DST가 있는 타임존을 쓰게 되면 이 모듈을 Intl 기반으로 바꿔야 한다.

const MIN = 60000;
export const SEOUL_OFFSET_MIN = 540;

const pad = n => String(n).padStart(2, '0');

export function toCivil(date, offsetMin = SEOUL_OFFSET_MIN) {
  const t = new Date(date.getTime() + offsetMin * MIN);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    h: t.getUTCHours(),
    mi: t.getUTCMinutes()
  };
}

export function fromCivil(c, offsetMin = SEOUL_OFFSET_MIN) {
  return new Date(Date.UTC(c.y, c.m - 1, c.d, c.h ?? 0, c.mi ?? 0) - offsetMin * MIN);
}

const civilFromUtc = t => ({
  y: t.getUTCFullYear(),
  m: t.getUTCMonth() + 1,
  d: t.getUTCDate(),
  h: t.getUTCHours(),
  mi: t.getUTCMinutes()
});

const asUtc = c => new Date(Date.UTC(c.y, c.m - 1, c.d, c.h ?? 0, c.mi ?? 0));

export function addMinutes(c, n) {
  const t = asUtc(c);
  t.setUTCMinutes(t.getUTCMinutes() + n);
  return civilFromUtc(t);
}

export function addDays(c, n) {
  const t = asUtc(c);
  t.setUTCDate(t.getUTCDate() + n);
  return civilFromUtc(t);
}

// 월 이동은 말일을 클램프한다. 1/31 + 1개월 = 2/28 (2/31이 3/3으로 넘어가지 않도록).
export function addMonths(c, n) {
  const targetMonth = c.m - 1 + n;
  const y = c.y + Math.floor(targetMonth / 12);
  const m = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { y, m: m + 1, d: Math.min(c.d, lastDay), h: c.h ?? 0, mi: c.mi ?? 0 };
}

export const addYears = (c, n) => addMonths(c, n * 12);

// Calendar API는 timeZone이 함께 오면 오프셋 없는 RFC3339를 허용한다.
export const fmtDateTime = c =>
  `${c.y}-${pad(c.m)}-${pad(c.d)}T${pad(c.h ?? 0)}:${pad(c.mi ?? 0)}:00`;

export const fmtDate = c => `${c.y}-${pad(c.m)}-${pad(c.d)}`;

// 날짜만 비교 (시각 무시)
export function compareDate(a, b) {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}
