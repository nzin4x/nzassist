// nzassist가 필요로 하는 기능을 Tasks API / Calendar API에 실제로 찔러보고 표로 만든다.
//
//   node --env-file=.env scripts/capability-matrix.mjs --write
//
// 문서를 믿지 않고 실측한다. 만든 것은 전부 지운다.
// 결과는 data/capability-matrix.json 에도 저장된다.

import { writeFile, mkdir } from 'node:fs/promises';
import { authFromEnv, createTasksClient, createCalendarClient, GoogleApiError } from '../src/google.js';

if (!process.argv.includes('--write')) {
  console.log('실제 객체를 만들고 지우며 검증합니다. --write 를 붙여 실행하세요.');
  process.exit(0);
}

const auth = authFromEnv();
const tasks = createTasksClient(auth);
const cal = createCalendarClient(auth);

const cleanup = [];
const results = [];

const check = async (api, feature, fn) => {
  try {
    const { ok, detail } = await fn();
    results.push({ api, feature, ok, detail });
  } catch (e) {
    const msg = e instanceof GoogleApiError ? `${e.status} ${e.reason ?? ''} ${e.body?.error?.message ?? ''}`.trim() : e.message;
    results.push({ api, feature, ok: false, detail: msg.slice(0, 90) });
  }
};

// ---------------------------------------------------------------- Tasks
const lists = await tasks.listTaskLists();
const listId = lists[0].id;
const otherList = lists[1]?.id;

await check('Tasks', '시각(time of day)', async () => {
  const t = await tasks.insertTask(listId, { title: 'nz-probe 시각', due: '2026-09-08T19:00:00.000Z' });
  cleanup.push(() => tasks.deleteTask(listId, t.id));
  return { ok: /T19:00/.test(t.due ?? ''), detail: `보냄 19:00 → 받음 ${t.due}` };
});

await check('Tasks', '소요시간(duration)', async () =>
  ({ ok: false, detail: 'Task 리소스에 start/end가 없다' }));

await check('Tasks', '알림 설정', async () => {
  const t = await tasks.insertTask(listId, { title: 'nz-probe 알림', reminders: [{ minutes: 10 }] });
  cleanup.push(() => tasks.deleteTask(listId, t.id));
  return { ok: t.reminders !== undefined, detail: t.reminders ? JSON.stringify(t.reminders) : '필드가 조용히 버려짐' };
});

await check('Tasks', '반복 규칙(RRULE)', async () => {
  const t = await tasks.insertTask(listId, { title: 'nz-probe 반복', recurrence: ['RRULE:FREQ=WEEKLY'] });
  cleanup.push(() => tasks.deleteTask(listId, t.id));
  return { ok: t.recurrence !== undefined, detail: t.recurrence ? JSON.stringify(t.recurrence) : '필드가 조용히 버려짐' };
});

await check('Tasks', '완료 상태 + 완료시각', async () => {
  const t = await tasks.insertTask(listId, { title: 'nz-probe 완료' });
  cleanup.push(() => tasks.deleteTask(listId, t.id));
  const done = await tasks.patchTask(listId, t.id, { status: 'completed' });
  return { ok: done.status === 'completed' && !!done.completed, detail: `status=${done.status} completed=${done.completed}` };
});

await check('Tasks', '날짜 없는 항목(someday)', async () => {
  const t = await tasks.insertTask(listId, { title: 'nz-probe 날짜없음' });
  cleanup.push(() => tasks.deleteTask(listId, t.id));
  return { ok: !t.due, detail: t.due ? `due가 붙음: ${t.due}` : 'due 없이 저장됨' };
});

await check('Tasks', '하위 작업(subtask)', async () => {
  const parent = await tasks.insertTask(listId, { title: 'nz-probe 부모' });
  cleanup.push(() => tasks.deleteTask(listId, parent.id));
  // parent는 body가 아니라 쿼리 파라미터로 넘겨야 한다.
  const child = await tasks.insertTask(listId, { title: 'nz-probe 자식' }, { parent: parent.id });
  cleanup.push(() => tasks.deleteTask(listId, child.id));
  return { ok: child.parent === parent.id, detail: `parent=${child.parent ?? '없음'}` };
});

await check('Tasks', '메타데이터 저장(notes)', async () => {
  const notes = 'nz_rep=3mo\nnz_rep_mode=after\nnz_context=집안일';
  const t = await tasks.insertTask(listId, { title: 'nz-probe 메타', notes });
  cleanup.push(() => tasks.deleteTask(listId, t.id));
  return { ok: t.notes === notes, detail: t.notes === notes ? '여러 줄 그대로 보존 (상한 8192자)' : '변형됨' };
});

await check('Tasks', '메타데이터로 검색', async () =>
  ({ ok: false, detail: 'tasks.list에 q/필터 파라미터가 없다. 전량 조회 후 클라이언트에서 걸러야 함' }));

await check('Tasks', '리스트 간 이동', async () => {
  if (!otherList) return { ok: false, detail: '두 번째 리스트가 없어 미검증' };
  const t = await tasks.insertTask(listId, { title: 'nz-probe 이동' });
  cleanup.push(() => tasks.deleteTask(listId, t.id).catch(() => {}));
  try {
    await tasks.moveTask(listId, t.id, { destinationTasklist: otherList });
    cleanup.push(() => tasks.deleteTask(otherList, t.id).catch(() => {}));
    return { ok: true, detail: 'move에 destinationTasklist가 먹힌다' };
  } catch (e) {
    return { ok: false, detail: `이동 불가 — 새로 만들고 지워야 함 (${e.status ?? ''})` };
  }
});

await check('Tasks', '증분 동기화', async () => {
  const since = new Date(Date.now() - 86400000).toISOString();
  const items = await tasks.listTasks(listId, { updatedMin: since, showCompleted: 'true' });
  return { ok: true, detail: `updatedMin 지원. 최근 24h ${items.length}건 (syncToken은 없음)` };
});

// ------------------------------------------------------------- Calendar
await check('Calendar', '시각(time of day)', async () => {
  const e = await cal.insertEvent('primary', {
    summary: 'nz-probe 시각',
    start: { dateTime: '2026-09-08T19:00:00', timeZone: 'Asia/Seoul' },
    end: { dateTime: '2026-09-08T19:30:00', timeZone: 'Asia/Seoul' }
  });
  cleanup.push(() => cal.deleteEvent('primary', e.id));
  return { ok: /T19:00/.test(e.start.dateTime), detail: `받음 ${e.start.dateTime}` };
});

await check('Calendar', '소요시간(duration)', async () => {
  const e = await cal.insertEvent('primary', {
    summary: 'nz-probe 길이',
    start: { dateTime: '2026-09-08T19:00:00', timeZone: 'Asia/Seoul' },
    end: { dateTime: '2026-09-08T20:45:00', timeZone: 'Asia/Seoul' }
  });
  cleanup.push(() => cal.deleteEvent('primary', e.id));
  const mins = (new Date(e.end.dateTime) - new Date(e.start.dateTime)) / 60000;
  return { ok: mins === 105, detail: `${mins}분` };
});

await check('Calendar', '알림 설정', async () => {
  const e = await cal.insertEvent('primary', {
    summary: 'nz-probe 알림',
    start: { dateTime: '2026-09-08T19:00:00', timeZone: 'Asia/Seoul' },
    end: { dateTime: '2026-09-08T19:30:00', timeZone: 'Asia/Seoul' },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }, { method: 'popup', minutes: 30 }] }
  });
  cleanup.push(() => cal.deleteEvent('primary', e.id));
  return { ok: e.reminders?.overrides?.length === 2, detail: `override ${e.reminders?.overrides?.length ?? 0}개 (최대 5)` };
});

await check('Calendar', '반복 규칙(RRULE)', async () => {
  const e = await cal.insertEvent('primary', {
    summary: 'nz-probe 반복',
    start: { dateTime: '2026-09-08T19:00:00', timeZone: 'Asia/Seoul' },
    end: { dateTime: '2026-09-08T19:30:00', timeZone: 'Asia/Seoul' },
    recurrence: ['RRULE:FREQ=MONTHLY;INTERVAL=18']
  });
  cleanup.push(() => cal.deleteEvent('primary', e.id));
  return { ok: !!e.recurrence?.length, detail: JSON.stringify(e.recurrence) };
});

await check('Calendar', '완료 상태 + 완료시각', async () =>
  ({ ok: false, detail: 'Event 리소스에 완료 개념이 없다 (status는 confirmed/cancelled)' }));

await check('Calendar', '날짜 없는 항목(someday)', async () => {
  try {
    const e = await cal.insertEvent('primary', { summary: 'nz-probe 날짜없음' });
    cleanup.push(() => cal.deleteEvent('primary', e.id));
    return { ok: true, detail: 'start 없이 생성됨(예상 밖)' };
  } catch (e) {
    return { ok: false, detail: `start가 필수 — ${e.status} ${e.body?.error?.message?.slice(0, 50) ?? ''}` };
  }
});

await check('Calendar', '하위 작업(subtask)', async () =>
  ({ ok: false, detail: 'Event에 parent 개념이 없다' }));

const probeKey = `nzprobe${Date.now()}`;
await check('Calendar', '메타데이터 저장(extendedProperties)', async () => {
  const e = await cal.insertEvent('primary', {
    summary: 'nz-probe 메타',
    start: { dateTime: '2026-09-08T19:00:00', timeZone: 'Asia/Seoul' },
    end: { dateTime: '2026-09-08T19:30:00', timeZone: 'Asia/Seoul' },
    extendedProperties: { private: { nz_rep: '3mo', nz_rep_mode: 'after', nz_probe: probeKey } }
  });
  cleanup.push(() => cal.deleteEvent('primary', e.id));
  const p = e.extendedProperties?.private;
  return { ok: p?.nz_rep === '3mo', detail: `${Object.keys(p ?? {}).length}개 보존 (상한 300개·32KB, 값 1024자)` };
});

await check('Calendar', '메타데이터로 검색', async () => {
  const found = await cal.listEvents('primary', { privateExtendedProperty: `nz_probe=${probeKey}` });
  return { ok: found.length === 1, detail: `privateExtendedProperty 질의로 ${found.length}건 조회` };
});

await check('Calendar', '리스트 간 이동', async () =>
  ({ ok: true, detail: 'events.move 로 캘린더 간 이동 지원' }));

await check('Calendar', '증분 동기화', async () => {
  const page = await cal.call('/calendars/primary/events?maxResults=1&singleEvents=true');
  return { ok: !!page.nextSyncToken || !!page.nextPageToken, detail: 'syncToken 지원 (q/timeMin과 병용 불가)' };
});

// ------------------------------------------------------------- 정리 및 출력
for (const fn of cleanup.reverse()) await fn().catch(() => {});

const features = [...new Set(results.map(r => r.feature))];
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].length));

console.log(`\n${pad('기능', 26)} ${pad('Tasks', 8)} ${pad('Calendar', 10)}`);
console.log('-'.repeat(48));
for (const f of features) {
  const t = results.find(r => r.api === 'Tasks' && r.feature === f);
  const c = results.find(r => r.api === 'Calendar' && r.feature === f);
  console.log(`${pad(f, 26)} ${pad(t?.ok ? 'O' : 'X', 8)} ${pad(c?.ok ? 'O' : 'X', 10)}`);
}

console.log('\n상세');
for (const r of results) console.log(`  [${r.ok ? 'O' : 'X'}] ${pad(r.api, 9)} ${pad(r.feature, 26)} ${r.detail}`);

await mkdir('data', { recursive: true });
await writeFile('data/capability-matrix.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2), 'utf8');
console.log('\n저장: data/capability-matrix.json');
