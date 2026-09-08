// 동반 Calendar 이벤트 — task의 "Add time" 을 실제 알람으로 만드는 장치 (D6/D11).
//
// Google Tasks UI에도 Add time이 있지만 **API로는 읽지도 쓰지도 못한다** (실측).
// UI에서 22:30으로 바꿔도 API는 00:00:00만 보여준다. 그래서 nzassist는
// 시각을 notes의 at= 에 두고, 알람은 별도 Calendar 이벤트가 울린다.
//
// 이벤트는 task의 단방향 투영이다. 사람이 이벤트를 옮겨도 task 기준으로 되돌아간다.

export const APP_TAG = 'nzassist';
const DEFAULT_DURATION_MIN = 30;

const pad = n => String(n).padStart(2, '0');

/** 'HH:MM' + 분 → 'HH:MM' (자정을 넘으면 23:59로 자른다) */
export function addMinutesToTime(time, minutes) {
  const [h, mi] = time.split(':').map(Number);
  const total = h * 60 + mi + minutes;
  if (total >= 24 * 60) return '23:59';
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** 'PT30M' / '30m' / '1h30m' / 90 → 분 */
export function parseDuration(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_DURATION_MIN;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  for (const [, n, unit] of s.matchAll(/(\d+)\s*(h|m)/gi)) {
    total += Number(n) * (unit.toLowerCase() === 'h' ? 60 : 1);
  }
  return total || DEFAULT_DURATION_MIN;
}

/**
 * task(shape된 형태)로 Calendar 이벤트 본문을 만든다. 순수 함수.
 * @param {object} t   { id, listId, title, due, at, meta, notes }
 * @param {object} [opts] { timeZone, reminderMinutes }
 * @returns {object|null} at 이나 due가 없으면 null (알람을 걸 수 없다)
 */
export function companionEvent(t, opts = {}) {
  const { timeZone = 'Asia/Seoul', reminderMinutes = [0] } = opts;
  if (!t.due || !t.at) return null;

  const durationMin = parseDuration(t.meta?.dur);
  const end = addMinutesToTime(t.at, durationMin);

  return {
    summary: t.title,
    start: { dateTime: `${t.due}T${t.at}:00`, timeZone },
    end: { dateTime: `${t.due}T${end}:00`, timeZone },
    reminders: { useDefault: false, overrides: reminderMinutes.map(minutes => ({ method: 'popup', minutes })) },
    description: [t.notes, `nzassist가 관리하는 알람입니다. 수정은 할 일 쪽에서 하세요.`]
      .filter(Boolean).join('\n\n'),
    extendedProperties: {
      private: { nz_app: APP_TAG, nz_task: t.id, nz_list: t.listId }
    }
  };
}

/** 이 이벤트가 nzassist가 만든 동반 이벤트인가. */
export const isCompanion = event => event?.extendedProperties?.private?.nz_app === APP_TAG;

/**
 * 동반 이벤트를 task 상태에 맞춘다.
 * @returns {{gcal: string|null, changed: boolean}} notes 메타에 반영할 값
 */
export async function syncCompanion(cal, shaped, { calendarId = 'primary', ...opts } = {}) {
  const existing = shaped.meta?.gcal || null;
  const body = shaped.completed ? null : companionEvent(shaped, opts);

  // 알람이 필요 없어졌으면 (시각 제거 · 완료 · 날짜 제거) 이벤트를 지운다
  if (!body) {
    if (existing) await cal.deleteEvent(calendarId, existing).catch(() => {});
    return { gcal: null, changed: Boolean(existing) };
  }

  if (existing) {
    try {
      await cal.patchEvent(calendarId, existing, body);
      return { gcal: existing, changed: true };
    } catch {
      // 사람이 캘린더에서 지웠을 수 있다. 다시 만든다.
    }
  }

  const created = await cal.insertEvent(calendarId, body);
  return { gcal: created.id, changed: true };
}
