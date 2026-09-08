// 다음 회차 due 계산 (D7).
//
//   fixed : 이전 due + 간격          — 원래 스케줄을 지킨다
//   after : 완료일 + 간격            — 늦게 하면 그만큼 다음도 밀린다
//
// 정수기 필터를 3개월마다 갈아야 하는데 한 달 늦게 갈았다면,
// after 모드에서는 "완료일 + 3개월"이지 "원래 스케줄 기준 2개월 후"가 아니다.

import { addDays, addMonths, addYears, fmtDate, toCivil, SEOUL_OFFSET_MIN } from './civil.js';

const UNIT_RE = /^(\d+)(m|h|d|w|mo|y)$/;

export function parseInterval(rep) {
  const m = UNIT_RE.exec(String(rep ?? '').trim());
  if (!m) return null;
  return { count: Number(m[1]), unit: m[2] };
}

/** 벽시계 날짜(YYYY-MM-DD)에 간격을 더한다. */
export function addInterval(date, { count, unit }) {
  const [y, mo, d] = date.split('-').map(Number);
  const c = { y, m: mo, d, h: 0, mi: 0 };
  switch (unit) {
    // 분·시간 간격은 due가 날짜 단위라 날짜를 바꾸지 않는다 (시각은 메타의 at= 이 담당)
    case 'm': case 'h': return date;
    case 'd': return fmtDate(addDays(c, count));
    case 'w': return fmtDate(addDays(c, count * 7));
    case 'mo': return fmtDate(addMonths(c, count));
    case 'y': return fmtDate(addYears(c, count));
    default: return date;
  }
}

/**
 * @param {object} o
 * @param {string} o.rep          '3mo' 같은 간격
 * @param {'fixed'|'after'} o.mode
 * @param {string} [o.previousDue] 'YYYY-MM-DD'
 * @param {string} [o.completedAt] RFC3339
 * @returns {string} 다음 due 'YYYY-MM-DD'
 */
export function nextDue({ rep, mode, previousDue, completedAt, offsetMin = SEOUL_OFFSET_MIN }) {
  const interval = parseInterval(rep);
  if (!interval) return previousDue ?? null;

  const completedDate = completedAt ? fmtDate(toCivil(new Date(completedAt), offsetMin)) : null;
  const base = mode === 'after'
    ? completedDate ?? previousDue
    : previousDue ?? completedDate;

  if (!base) return null;

  let next = addInterval(base, interval);
  // 고정 스케줄인데 이미 지난 회차라면 오늘 이후로 따라잡는다.
  if (mode !== 'after' && completedDate) {
    let guard = 0;
    while (next <= completedDate && guard++ < 500) next = addInterval(next, interval);
  }
  return next;
}
