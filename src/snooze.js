// 스누즈 — 절대 시각으로 옮긴다. postpone(src/api.js)의 날짜 단위 간격과 달리
// 여기는 분·시간 단위까지 정확히 옮겨야 한다. 예전 postpone은 `m`/`h` 단위를
// 조용히 무시했다 (due가 날짜 단위라서) — 알림 자체를 다시 울리는 게 스누즈의
// 전체 목적인데 시각을 안 바꾸면 아무 일도 안 일어난다.
//
// 프리셋 버튼도 커스텀 입력("10m", "2d", "내일 9시")도 결국 같은 함수를 거친다:
// 정해진 문구 몇 개만 특별 취급하고, 나머지는 기존 자연어 파서에 그대로 넘긴다.
// "내일 9시" 같은 절대 표현이 이미 parse()에서 되므로 새로 만들 게 거의 없다.

import { toCivil, addMinutes, addDays, addMonths, addYears, fmtDateTime, fmtDate } from './civil.js';
import { parse } from './parse.js';

const AFTER_WORK_HOUR = 18; // 설정으로 뺄 수 있지만 개인용 기본값으로 충분하다

const UNIT_RE = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks|mo|month|months|y|year|years)$/i;

const unitKey = raw => {
  const u = raw.toLowerCase();
  if (/^m(in)?/.test(u)) return 'm';
  if (/^h/.test(u)) return 'h';
  if (/^d/.test(u)) return 'd';
  if (/^w/.test(u)) return 'w';
  if (/^mo/.test(u)) return 'mo';
  if (/^y/.test(u)) return 'y';
  return null;
};

function addUnit(civil, count, unit) {
  switch (unit) {
    case 'm': return addMinutes(civil, count);
    case 'h': return addMinutes(civil, count * 60);
    case 'd': return addDays(civil, count);
    case 'w': return addDays(civil, count * 7);
    case 'mo': return addMonths(civil, count);
    case 'y': return addYears(civil, count);
    default: return civil;
  }
}

/** 다가오는 토요일(오늘이 토요일이면 오늘) civil 날짜. 시각 비교는 호출부에서 한다. */
function nextWeekday(today, targetDow) {
  const cur = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
  return addDays(today, (targetDow - cur + 7) % 7);
}

const withTime = (civil, hhmm) => {
  const [h, mi] = hhmm.split(':').map(Number);
  return { ...civil, h, mi };
};

/**
 * @param {string} input          프리셋 문구('10분 후' 등) 또는 커스텀 입력('10m', '2d', '내일 9시')
 * @param {object} [opts]
 * @param {Date}   [opts.now]
 * @param {string} [opts.defaultTime]  '아침' 계열 프리셋에 쓰는 기본 시각
 * @returns {{ dateTime: string, label: string }}  dateTime은 오프셋 없는 로컬 벽시계 ISO
 */
export function resolveSnooze(input, opts = {}) {
  const { now = new Date(), offsetMin, defaultTime = '09:00', timeZone = 'Asia/Seoul' } = opts;
  const today = toCivil(now, offsetMin);
  const text = String(input ?? '').trim();

  // --- 고정 문구 프리셋 ---
  const NAMED = {
    '10분 후': () => addMinutes(today, 10),
    '30분 후': () => addMinutes(today, 30),
    '1시간 후': () => addMinutes(today, 60),
    '2시간 후': () => addMinutes(today, 120),
    '퇴근 후': () => {
      const candidate = { ...today, h: AFTER_WORK_HOUR, mi: 0 };
      return fmtDateTime(candidate) > fmtDateTime(today) ? candidate : withTime(addDays(today, 1), '18:00');
    },
    '내일 아침': () => withTime(addDays(today, 1), defaultTime),
    '주말 아침': () => {
      let sat = nextWeekday(today, 6); // 토요일
      if (fmtDateTime(withTime(sat, defaultTime)) <= fmtDateTime(today)) sat = addDays(sat, 7);
      return withTime(sat, defaultTime);
    },
    '다음주 아침': () => nextMonday(today, defaultTime)
  };
  if (NAMED[text]) return { dateTime: fmtDateTime(NAMED[text]()), label: text };

  // --- 커스텀 상대값: 10m / 2d / 1h30m 같은 짧은 표기 ---
  const bare = UNIT_RE.exec(text);
  if (bare) {
    const unit = unitKey(bare[2]);
    if (unit) {
      const civil = addUnit(today, Number(bare[1]), unit);
      return { dateTime: fmtDateTime(civil), label: `${bare[1]}${unit} 후` };
    }
  }

  // --- 그 외는 전부 기존 자연어 파서로: "내일 9시", "다음주 금요일" 등 ---
  const parsed = parse(text, { now, offsetMin, timeZone, defaultTime });
  return { dateTime: parsed.start.dateTime, label: parsed.title || text };
}

// 다음 "달력주"의 월요일. 월요일 기준 isoCur=0이면 7일 뒤, 일요일(isoCur=6)이면 1일 뒤(내일)다.
function nextMonday(today, defaultTime) {
  const cur = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
  const isoCur = (cur + 6) % 7;
  return withTime(addDays(today, 7 - isoCur), defaultTime);
}

/** 프리셋 버튼 목록. UI가 그대로 순회해서 렌더링한다. */
export const SNOOZE_PRESETS = [
  { text: '10분 후', icon: '⏱️' },
  { text: '30분 후', icon: '⏰' },
  { text: '1시간 후', icon: '🕐' },
  { text: '퇴근 후', icon: '🏃' },
  { text: '내일 아침', icon: '🌅' },
  { text: '주말 아침', icon: '🛌' },
  { text: '다음주 아침', icon: '📅' }
];
