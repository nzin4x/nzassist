// Todoist task -> nzassist(Google Tasks) 변환.
//
// Todoist의 due.date에는 이미 시각까지 해결된 값이 들어 있으므로
// 자연어를 다시 파싱할 필요가 없다. due.string은 **반복 규칙을 뽑을 때만** 쓴다.
//
// due.date 형태 (실측 202건 기준)
//   "2025-09-23T07:00:00"   floating + 시각    92건
//   "2024-11-30"            날짜만             53건
//   "2026-08-08T23:00:00Z"  UTC instant         4건  → Asia/Seoul로 환산
//   (없음)                   날짜 없음          53건  → someday task

import { parse } from './parse.js';
import { toTask } from './task.js';
import { toCivil, fmtDate, SEOUL_OFFSET_MIN } from './civil.js';

/** Todoist due를 벽시계 날짜/시각으로 편다. */
export function readDue(due, { defaultTime = '09:00', offsetMin = SEOUL_OFFSET_MIN } = {}) {
  const raw = due?.date;
  if (!raw) return { date: null, time: null };

  if (raw.endsWith('Z')) {
    const c = toCivil(new Date(raw), offsetMin);
    return { date: fmtDate(c), time: `${String(c.h).padStart(2, '0')}:${String(c.mi).padStart(2, '0')}` };
  }
  if (raw.includes('T')) return { date: raw.slice(0, 10), time: raw.slice(11, 16) };
  return { date: raw, time: defaultTime };
}

/**
 * 반복 규칙만 뽑는다. Todoist가 is_recurring이라고 했는데 파서가 상대 표현으로만
 * 읽었다면("2주후에") 간격으로 승격시킨다.
 */
export function readRepeat(due, now = new Date()) {
  if (!due?.is_recurring || !due.string) return null;
  const p = parse(due.string, { now });
  if (p.repeat) return { interval: p.repeat.interval, mode: p.repeat.mode, byday: p.repeat.byday, monthday: p.repeat.bymonthday };
  if (p.relativeInterval) return { interval: p.relativeInterval.interval, mode: 'fixed', promoted: true };
  return null;
}

/** Todoist 라벨을 #tag로 붙인다 (D4). 이미 제목에 있는 태그는 중복시키지 않는다. */
export function withTags(content, labels = []) {
  const missing = labels.filter(l => !new RegExp(`(^|\\s)#${escapeRe(l)}(\\s|$)`).test(content));
  return missing.length ? `${content} ${missing.map(l => `#${l}`).join(' ')}` : content;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {object} t          Todoist task
 * @param {object} opts
 * @param {string} [opts.context]  프로젝트 이름 (nz_context)
 * @param {string} [opts.batch]    되돌리기용 배치 id
 * @returns {{task: object, warnings: string[]}} Google Tasks 리소스
 */
export function convert(t, opts = {}) {
  const { context, batch, defaultTime = '09:00', now = new Date() } = opts;
  const warnings = [];

  const { date, time } = readDue(t.due, { defaultTime });
  const repeat = readRepeat(t.due, now);

  if (t.due?.is_recurring && !repeat) {
    warnings.push(`반복 문장을 못 읽음: "${t.due.string}"`);
  }
  if (repeat?.promoted) {
    warnings.push(`"${t.due.string}" 를 ${repeat.interval} 간격으로 해석함 — 확인 필요`);
  }

  const title = withTags(t.content, t.labels);

  // parse()를 거치지 않고 직접 조립한다. 날짜/시각은 Todoist가 이미 확정했으므로
  // 제목을 다시 파싱하면 오히려 제목 속 숫자를 날짜로 오인할 수 있다.
  const parsed = {
    title,
    context: context ?? null,
    tags: t.labels ?? [],
    start: { dateTime: `${date ?? '1970-01-01'}T${time ?? defaultTime}:00` },
    repeat: repeat && { interval: repeat.interval, mode: repeat.mode, byday: repeat.byday, bymonthday: repeat.monthday },
    raw: t.due?.string ?? '',
    warnings: []
  };

  const task = toTask(parsed, {
    userNotes: t.description ?? '',
    batch,
    extra: {
      src: 'todoist',
      src_id: t.id,
      // Todoist 우선순위는 4가 가장 높다. 기본값(1)은 굳이 기록하지 않는다.
      priority: t.priority && t.priority !== 1 ? String(t.priority) : undefined
    }
  });

  // 날짜가 없으면 due를 붙이지 않는다 (someday). Tasks는 이걸 지원한다.
  if (!date) delete task.due;

  return { task, warnings };
}
