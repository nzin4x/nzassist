// 파서 결과 <-> Google Calendar 이벤트 리소스 변환.
//
// D5: 사람이 읽는 값은 summary에, 기계용 값은 extendedProperties.private 에 둔다.
// extendedProperties 값은 반드시 문자열이다 (키 44자 / 값 1024자 / 이벤트당 300개·32KB).

import { randomBytes } from 'node:crypto';

export const NS = 'nz_';
const MAX_KEY = 44;
const MAX_VALUE = 1024;

export const newShortId = () =>
  randomBytes(8).toString('base64').replace(/[+/=]/g, '').slice(0, 10);

// 완료 링크. Calendar 알림에는 완료 액션이 없으므로 본문 링크로 대신한다 (D8).
export const completionLink = (baseUrl, shortId) =>
  baseUrl ? `${baseUrl.replace(/\/$/, '')}/t/${shortId}?done=1` : null;

function props(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue;
    const key = k.startsWith(NS) ? k : NS + k;
    const value = String(v);
    if (key.length > MAX_KEY) throw new Error(`extendedProperties 키가 44자를 넘습니다: ${key}`);
    out[key] = value.length > MAX_VALUE ? value.slice(0, MAX_VALUE) : value;
  }
  return out;
}

/**
 * 파서 결과를 Calendar 이벤트 리소스로 만든다.
 * @param {object} parsed  parse() 의 반환값
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]          완료 링크 도메인
 * @param {number[]} [opts.reminderMinutes] 알림 오프셋(분 전). 기본 [0]
 * @param {string} [opts.shortId]
 * @param {object} [opts.extra]            추가 nz_* 속성 (마이그레이션 출처 등)
 */
export function toEvent(parsed, opts = {}) {
  const { baseUrl = '', reminderMinutes = [0], shortId = newShortId(), extra = {} } = opts;

  if (reminderMinutes.length > 5) throw new Error('알림은 이벤트당 최대 5개입니다.');
  for (const m of reminderMinutes) {
    if (!Number.isInteger(m) || m < 0 || m > 40320) throw new Error(`알림 오프셋은 0~40320분이어야 합니다: ${m}`);
  }

  const link = completionLink(baseUrl, shortId);
  const description = [link && `✅ 완료하기 → ${link}`, parsed.description]
    .filter(Boolean).join('\n\n') || undefined;

  const event = {
    summary: parsed.title,
    start: parsed.start,
    end: parsed.end,
    reminders: { useDefault: false, overrides: reminderMinutes.map(minutes => ({ method: 'popup', minutes })) },
    extendedProperties: {
      private: props({
        short_id: shortId,
        context: parsed.context,
        tags: parsed.tags?.join(','),
        rep: parsed.repeat?.interval,
        rep_mode: parsed.repeat?.mode,
        raw: parsed.raw,
        ...extra
      })
    }
  };

  if (description) event.description = description;
  // 완료 기준 반복은 RRULE로 표현할 수 없어 단발 이벤트로 둔다 (D7).
  if (parsed.repeat?.rrule) event.recurrence = [parsed.repeat.rrule];

  return event;
}

/** 이벤트 리소스에서 nz_* 속성을 꺼낸다. */
export function readProps(event) {
  const raw = event?.extendedProperties?.private ?? {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith(NS)) out[k.slice(NS.length)] = v;
  }
  return out;
}

export const isDone = event => readProps(event).done === '1';

/** events.list 의 privateExtendedProperty 필터 문자열. */
export const propFilter = (key, value) => `${key.startsWith(NS) ? key : NS + key}=${value}`;
