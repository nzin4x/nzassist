// 자연어 한 줄 -> Google Calendar 이벤트 초안.
//
// 규칙 기반이고 의존성이 없다. LLM은 이 파서가 실패했을 때만 부르며(백로그),
// 결과는 항상 제안 카드로 확인받는다.
//
// 표기 (D3/D5):
//   @context  -> 컨텍스트. title에서 제거되고 nz_context가 된다. 2개 이상이면 첫 번째만.
//   #tag      -> 태그. native Calendar 앱에서 보이도록 title에 그대로 남긴다.

import {
  SEOUL_OFFSET_MIN, toCivil, addMinutes, addDays, addMonths, addYears,
  fmtDateTime, compareDate
} from './civil.js';

const UNITS = {
  m: { short: 'm', freq: 'MINUTELY' },
  h: { short: 'h', freq: 'HOURLY' },
  d: { short: 'd', freq: 'DAILY' },
  w: { short: 'w', freq: 'WEEKLY' },
  mo: { short: 'mo', freq: 'MONTHLY' },
  y: { short: 'y', freq: 'YEARLY' }
};

const unitKey = word => {
  const w = word.toLowerCase();
  if (/^min/.test(w) || w === '분') return 'm';
  if (/^h/.test(w) || w === '시간') return 'h';
  if (/^d/.test(w) || w === '일') return 'd';
  if (/^w/.test(w) || w === '주') return 'w';
  if (/^mo/.test(w) || w === '개월' || w === '달') return 'mo';
  if (/^y/.test(w) || w === '년') return 'y';
  return null;
};

const WEEKDAY_EN = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const WEEKDAY_KO = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const UNIT_WORD = '(min(?:ute)?s?|hours?|days?|weeks?|months?|years?|분|시간|일|주|개월|달|년)';

const cut = (s, match) => s.replace(match, ' ');
const tidy = s => s.replace(/\s{2,}/g, ' ').trim();

// --- 반복 -------------------------------------------------------------------

// Todoist는 "every"를 "ev"로 줄여 쓰는 것도 받아준다. 실제 데이터에 `ev day 7 pm` 이 있었다.
const EVERY = '\\bev(?:ery)?';
const ORD = '(?:st|nd|rd|th)?';

const mk = (count, unit, bang, extra = {}) => ({
  interval: `${count}${UNITS[unit].short}`,
  mode: bang ? 'after' : 'fixed',
  count, unit, ...extra
});

function extractRepeat(text) {
  let rest = text;

  // every 1 week / every! 2 weeks / every year / ev day
  let m = rest.match(new RegExp(`${EVERY}(!)?\\s+(?:(\\d+)\\s*)?${UNIT_WORD}\\b`, 'i'));
  if (m) {
    const key = unitKey(m[3]);
    if (key) return { rest: cut(rest, m[0]), repeat: mk(m[2] ? Number(m[2]) : 1, key, m[1]) };
  }

  // 매! 30일  (한국어 완료 기준 반복)
  m = rest.match(new RegExp(`매(!)\\s*(\\d+)\\s*${UNIT_WORD}`));
  if (m) {
    const key = unitKey(m[3]);
    if (key) return { rest: cut(rest, m[0]), repeat: mk(Number(m[2]), key, m[1]) };
  }

  // every! 7/5 · every 3-1  -> 매년 7월 5일 / 3월 1일
  m = rest.match(new RegExp(`${EVERY}(!)?\\s+(\\d{1,2})[\\/-](\\d{1,2})\\b`, 'i'));
  if (m) {
    return {
      rest: cut(rest, m[0]),
      repeat: mk(1, 'y', m[1]),
      dateHint: { m: Number(m[2]), d: Number(m[3]) }
    };
  }

  // every 10 oct / every 28th dec / every dec 28
  m = rest.match(new RegExp(`${EVERY}(!)?\\s+(\\d{1,2})${ORD}\\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\b`, 'i'))
    ?? rest.match(new RegExp(`${EVERY}(!)?\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+(\\d{1,2})${ORD}\\b`, 'i'));
  if (m) {
    const monthFirst = /^[a-z]/i.test(m[2]);
    const month = MONTHS.indexOf((monthFirst ? m[2] : m[3]).toLowerCase()) + 1;
    const day = Number(monthFirst ? m[3] : m[2]);
    return { rest: cut(rest, m[0]), repeat: mk(1, 'y', m[1]), dateHint: { m: month, d: day } };
  }

  // 7월25일마다
  m = rest.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*마다/);
  if (m) {
    return {
      rest: cut(rest, m[0]),
      repeat: mk(1, 'y', false),
      dateHint: { m: Number(m[1]), d: Number(m[2]) }
    };
  }

  // every! workday  -> 평일
  m = rest.match(new RegExp(`${EVERY}(!)?\\s+(?:workday|weekday)s?\\b`, 'i'));
  if (m) {
    return { rest: cut(rest, m[0]), repeat: mk(1, 'w', m[1], { byday: 'MO,TU,WE,TH,FR' }) };
  }

  // every saturday / every sun
  m = rest.match(new RegExp(`${EVERY}(!)?\\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\\b`, 'i'));
  if (m) {
    const wd = WEEKDAY_EN[m[2].toLowerCase()];
    return { rest: cut(rest, m[0]), repeat: mk(1, 'w', m[1], { byday: BYDAY[wd] }), weekdayHint: wd };
  }

  // 토요일 마다 / 매주 토요일
  m = rest.match(/([일월화수목금토])요일\s*마다/) ?? rest.match(/매주\s*([일월화수목금토])요일/);
  if (m) {
    const wd = WEEKDAY_KO[m[1]];
    return { rest: cut(rest, m[0]), repeat: mk(1, 'w', false, { byday: BYDAY[wd] }), weekdayHint: wd };
  }

  // every 10th · every! 10th 09:00 · every 1st day 09:00  -> 매월 N일
  // (월 이름이 붙은 형태는 위에서 이미 걸러졌다)
  m = rest.match(new RegExp(`${EVERY}(!)?\\s+(\\d{1,2})(?:st|nd|rd|th)\\s*(?:day)?`, 'i'));
  if (m) {
    return {
      rest: cut(rest, m[0]),
      repeat: mk(1, 'mo', m[1], { bymonthday: Number(m[2]) }),
      monthdayHint: Number(m[2])
    };
  }

  // 매월 25일
  m = rest.match(/매(?:월|달)\s*(\d{1,2})\s*일/);
  if (m) {
    return {
      rest: cut(rest, m[0]),
      repeat: mk(1, 'mo', false, { bymonthday: Number(m[1]) }),
      monthdayHint: Number(m[1])
    };
  }

  // 매마지막날 -> 매월 말일. RRULE의 BYMONTHDAY=-1
  m = rest.match(/매\s*마지막\s*날/);
  if (m) {
    return { rest: cut(rest, m[0]), repeat: mk(1, 'mo', false, { bymonthday: -1 }), lastDayOfMonth: true };
  }

  for (const [re, unit] of [[/매년|매해/, 'y'], [/매월|매달/, 'mo'], [/매주/, 'w'], [/매일/, 'd']]) {
    const hit = rest.match(re);
    if (hit) return { rest: cut(rest, hit[0]), repeat: mk(1, unit, false) };
  }

  return { rest, repeat: null };
}

export function toRrule(repeat) {
  if (!repeat || repeat.mode === 'after') return null; // 완료 기준은 RRULE로 표현 불가 (D7)
  const parts = [`FREQ=${UNITS[repeat.unit].freq}`];
  if (repeat.count > 1) parts.push(`INTERVAL=${repeat.count}`);
  if (repeat.byday) parts.push(`BYDAY=${repeat.byday}`);
  if (repeat.bymonthday) parts.push(`BYMONTHDAY=${repeat.bymonthday}`);
  return `RRULE:${parts.join(';')}`;
}

// --- 시각 -------------------------------------------------------------------

function extractTime(text) {
  let rest = text;

  let m = rest.match(/(?:\bat\s+)?\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return { rest: cut(rest, m[0]), time: { h: Number(m[1]), mi: Number(m[2]) } };

  // 7am / 7 pm  (실제 데이터: "every day 7am", "ev day 7 pm")
  m = rest.match(/(?:\bat\s+)?\b(\d{1,2})\s*(am|pm)\b/i);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[2].toLowerCase() === 'pm') h += 12;
    return { rest: cut(rest, m[0]), time: { h, mi: 0 } };
  }

  m = rest.match(/(오전|오후)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?/);
  if (m) {
    let h = Number(m[2]);
    if (m[1] === '오후' && h < 12) h += 12;
    if (m[1] === '오전' && h === 12) h = 0;
    return { rest: cut(rest, m[0]), time: { h, mi: m[3] ? Number(m[3]) : 0 } };
  }

  return { rest, time: null };
}

// --- 날짜 -------------------------------------------------------------------

function extractDate(text) {
  let rest = text;

  let m = rest.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return { rest: cut(rest, m[0]), date: { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }, hasYear: true };

  m = rest.match(/\b(\d{1,2})월\s*(\d{1,2})일/);
  if (m) return { rest: cut(rest, m[0]), date: { m: Number(m[1]), d: Number(m[2]) }, hasYear: false };

  m = rest.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (m) return { rest: cut(rest, m[0]), date: { m: Number(m[1]), d: Number(m[2]) }, hasYear: false };

  m = rest.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
  if (m) return { rest: cut(rest, m[0]), date: { m: MONTHS.indexOf(m[2].toLowerCase()) + 1, d: Number(m[1]) }, hasYear: false };

  m = rest.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i);
  if (m) return { rest: cut(rest, m[0]), date: { m: MONTHS.indexOf(m[1].toLowerCase()) + 1, d: Number(m[2]) }, hasYear: false };

  return { rest, date: null, hasYear: false };
}

function extractRelative(text) {
  let rest = text;

  const m = rest.match(new RegExp(`\\bin\\s+(\\d+)\\s*${UNIT_WORD}\\b`, 'i'));
  if (m) {
    const key = unitKey(m[2]);
    if (key) return { rest: cut(rest, m[0]), relative: { count: Number(m[1]), unit: key } };
  }

  // 2주후에 / 3일 뒤
  const ko = rest.match(new RegExp(`(\\d+)\\s*${UNIT_WORD}\\s*(?:후|뒤)에?`));
  if (ko) {
    const key = unitKey(ko[2]);
    if (key) return { rest: cut(rest, ko[0]), relative: { count: Number(ko[1]), unit: key } };
  }

  for (const [re, days] of [[/모레/, 2], [/내일/, 1], [/오늘/, 0]]) {
    const hit = rest.match(re);
    if (hit) return { rest: cut(rest, hit[0]), relative: { count: days, unit: 'd' } };
  }

  return { rest, relative: null };
}

// --- 본체 -------------------------------------------------------------------

export function parse(text, opts = {}) {
  const {
    now = new Date(),
    offsetMin = SEOUL_OFFSET_MIN,
    timeZone = 'Asia/Seoul',
    defaultTime = '09:00',
    defaultDurationMin = 30
  } = opts;

  const warnings = [];
  const today = toCivil(now, offsetMin);
  let rest = ` ${text} `;

  // @context — title에서 제거한다
  const contexts = [];
  rest = rest.replace(/(^|\s)@([^\s@#]+)/g, (_, sp, name) => { contexts.push(name); return sp; });
  const context = contexts[0] ?? null;
  const demoted = contexts.slice(1);
  if (demoted.length) warnings.push(`@가 여러 개입니다. '${context}'만 컨텍스트로 쓰고 나머지는 태그로 내립니다: ${demoted.join(', ')}`);

  // #tag — title에 남긴다 (D5)
  const tags = [...text.matchAll(/(?:^|\s)#([^\s@#]+)/g)].map(m => m[1]);

  const rep = extractRepeat(rest);
  rest = rep.rest;

  const rel = extractRelative(rest);
  rest = rel.rest;

  const tm = extractTime(rest);
  rest = tm.rest;

  const dt = extractDate(rest);
  rest = dt.rest;

  // --- 시작 시각 결정 ---
  const [dh, dmi] = defaultTime.split(':').map(Number);
  let start;

  if (rel.relative && (rel.relative.unit === 'm' || rel.relative.unit === 'h')) {
    // "in 5 min" 은 지금 기준 정확한 오프셋. 기본 시각을 덮어쓰지 않는다.
    start = addMinutes(today, rel.relative.count * (rel.relative.unit === 'h' ? 60 : 1));
  } else {
    const time = tm.time ?? { h: dh, mi: dmi };
    let base = { ...today, ...time };

    if (dt.date) {
      base = { y: dt.date.y ?? today.y, m: dt.date.m, d: dt.date.d, ...time };
      // 연도를 안 썼는데 그 시각이 이미 지났으면 내년이다.
      // 오늘이 9/7 22시일 때 "9/7 21:00" 은 이미 지난 알람이므로 내년 9/7을 뜻한다.
      // (연도까지 쓴 "2026-09-07 21:00" 은 의도가 분명하므로 그대로 둔다)
      if (!dt.hasYear && fmtDateTime(base) <= fmtDateTime(today)) base = addYears(base, 1);
    } else if (rep.dateHint) {
      base = { y: today.y, m: rep.dateHint.m, d: rep.dateHint.d, ...time };
      if (fmtDateTime(base) <= fmtDateTime(today)) base = addYears(base, 1);
    } else if (rep.weekdayHint !== undefined) {
      const cur = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
      base = addDays({ ...today, ...time }, (rep.weekdayHint - cur + 7) % 7);
    } else if (rep.lastDayOfMonth) {
      base = { ...today, d: new Date(Date.UTC(today.y, today.m, 0)).getUTCDate(), ...time };
      if (compareDate(base, today) < 0) base = addMonths(base, 1);
    } else if (rep.monthdayHint !== undefined) {
      base = { ...today, d: rep.monthdayHint, ...time };
      if (compareDate(base, today) < 0) base = addMonths(base, 1);
    }

    if (rel.relative) {
      const n = rel.relative.count;
      if (rel.relative.unit === 'd') base = addDays(base, n);
      else if (rel.relative.unit === 'w') base = addDays(base, n * 7);
      else if (rel.relative.unit === 'mo') base = addMonths(base, n);
      else if (rel.relative.unit === 'y') base = addYears(base, n);
    }

    // 알림은 지난 시각으로 걸 수 없다. 날짜를 명시하지 않았는데 오늘의 그 시각이
    // 이미 지났으면 다음 날을 뜻한 것으로 본다.
    // (밤 10시에 "20:00" 이라고 쓰면 내일 저녁 8시다)
    const dateWasGiven = dt.date || rep.dateHint || rep.weekdayHint !== undefined
      || rep.monthdayHint !== undefined || rep.lastDayOfMonth || rel.relative;
    if (!dateWasGiven && fmtDateTime(base) <= fmtDateTime(today)) {
      base = addDays(base, 1);
      warnings.push(`오늘 ${String(time.h).padStart(2, '0')}:${String(time.mi).padStart(2, '0')} 은 지났으므로 내일로 잡았습니다.`);
    }

    start = base;
  }

  const end = addMinutes(start, defaultDurationMin);
  // 강등된 @는 사라지지 않고 #tag로 title에 되돌아온다 (D3)
  let title = tidy(rest);
  if (demoted.length) title = tidy(`${title} ${demoted.map(t => `#${t}`).join(' ')}`);
  if (!title) warnings.push('제목이 비었습니다.');

  return {
    title,
    context,
    tags: [...tags, ...demoted],
    start: { dateTime: fmtDateTime(start), timeZone },
    end: { dateTime: fmtDateTime(end), timeZone },
    repeat: rep.repeat ? { ...rep.repeat, rrule: toRrule(rep.repeat) } : null,
    // "2주후에" 처럼 상대 표현으로만 읽힌 간격. Todoist가 is_recurring이라고 표시한 경우
    // 마이그레이션에서 이 값을 반복 간격으로 승격시킨다.
    relativeInterval: rel.relative
      ? { ...rel.relative, interval: `${rel.relative.count}${UNITS[rel.relative.unit].short}` }
      : null,
    raw: text,
    warnings
  };
}
