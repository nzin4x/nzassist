// 파서 결과 <-> Google Tasks 리소스 변환.
//
// Tasks에는 extendedProperties가 없다. 대신 notes(8192자, 여러 줄 보존)의
// 하단 블록을 메타데이터 저장소로 쓴다 (D5).
//
//   사용자가 쓴 메모 (그대로 보존된다)
//
//   ---nzassist---
//   rep=3mo
//   rep_mode=after
//   at=19:00
//
// 이 블록의 존재 자체가 "nzassist가 관리 중" 마커다. native Tasks 앱에서 열면 눈에 보인다.

export const MARKER = '---nzassist---';
export const APP = 'nzassist';
const NOTES_LIMIT = 8192;

/** notes를 사용자 메모와 메타로 분리한다. */
export function readNotes(notes) {
  const text = notes ?? '';
  const at = text.indexOf(MARKER);
  if (at === -1) return { userNotes: text.trim(), meta: {} };

  const userNotes = text.slice(0, at).trim();
  const meta = {};
  for (const line of text.slice(at + MARKER.length).split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key) meta[key] = line.slice(eq + 1).trim();
  }
  return { userNotes, meta };
}

/** 사용자 메모는 건드리지 않고 메타만 다시 쓴다. */
export function writeNotes(userNotes, meta) {
  const entries = Object.entries(meta ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  const block = entries.length ? `${MARKER}\n${entries.map(([k, v]) => `${k}=${v}`).join('\n')}` : '';
  const body = [userNotes?.trim(), block].filter(Boolean).join('\n\n');
  if (body.length <= NOTES_LIMIT) return body;

  // 넘치면 사용자 메모를 자른다. 메타는 기계가 읽어야 하므로 지킨다.
  const room = NOTES_LIMIT - block.length - 2;
  return [`${userNotes.slice(0, Math.max(0, room - 1))}…`, block].filter(Boolean).join('\n\n');
}

export const readMeta = task => readNotes(task?.notes).meta;

/** nzassist가 만든 항목인가. 일괄 삭제와 normalizer 대상 판별에 쓴다. */
export const isManaged = task => (task?.notes ?? '').includes(MARKER);

/** Tasks의 due는 날짜만 담는다. 시각은 메타의 at= 이 원본이다. */
export const toDue = dateTime => `${String(dateTime).slice(0, 10)}T00:00:00.000Z`;

/** due(RFC3339)에서 날짜만 꺼낸다. */
export const dueDate = task => (task?.due ? task.due.slice(0, 10) : null);

/** 시각까지 합친 벽시계 문자열. 목록 정렬과 동반 이벤트 생성에 쓴다. */
export function scheduledAt(task) {
  const date = dueDate(task);
  if (!date) return null;
  const at = readMeta(task).at;
  return `${date}T${at && /^\d{1,2}:\d{2}$/.test(at) ? at.padStart(5, '0') : '00:00'}:00`;
}

/**
 * 파서 결과를 Tasks 리소스로 만든다.
 * @param {object} parsed  parse() 반환값
 * @param {object} [opts]
 * @param {string} [opts.userNotes]
 * @param {object} [opts.extra]  추가 메타 (마이그레이션 출처 등)
 * @param {string} [opts.batch]  일괄 삭제용 배치 id
 */
export function toTask(parsed, opts = {}) {
  const { userNotes = '', extra = {}, batch, now = new Date() } = opts;
  const time = parsed.start.dateTime.slice(11, 16);

  const meta = {
    app: APP,
    at: time,
    context: parsed.context ?? undefined,
    tags: parsed.tags?.length ? parsed.tags.join(',') : undefined,
    rep: parsed.repeat?.interval,
    rep_mode: parsed.repeat?.mode,
    rep_byday: parsed.repeat?.byday,
    rep_monthday: parsed.repeat?.bymonthday,
    raw: parsed.raw,
    batch,
    // Tasks API에는 생성 시각이 없다. JQL의 `created < 10d` 를 지원하려면 직접 찍어야 한다.
    created: now.toISOString(),
    ...extra
  };

  return {
    title: parsed.title,
    due: toDue(parsed.start.dateTime),
    notes: writeNotes(userNotes, meta)
  };
}

/** 기존 task의 사용자 메모를 지키면서 메타만 갱신한다. */
export function patchMeta(task, changes) {
  const { userNotes, meta } = readNotes(task?.notes);
  return { notes: writeNotes(userNotes, { ...meta, ...changes }) };
}
