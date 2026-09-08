import test from 'node:test';
import assert from 'node:assert/strict';
import { companionEvent, addMinutesToTime, parseDuration, isCompanion, syncCompanion } from '../src/companion.js';

const base = {
  id: 'task-1', listId: 'list-1', title: '노트북 반품하기',
  due: '2026-09-20', at: '22:30', completed: false, notes: '', meta: {}
};

test('시각 더하기', () => {
  assert.equal(addMinutesToTime('22:30', 30), '23:00');
  assert.equal(addMinutesToTime('09:00', 90), '10:30');
});

test('자정을 넘으면 23:59로 자른다', () => {
  assert.equal(addMinutesToTime('23:50', 30), '23:59');
});

test('소요시간 표기', () => {
  assert.equal(parseDuration('30m'), 30);
  assert.equal(parseDuration('1h30m'), 90);
  assert.equal(parseDuration('2h'), 120);
  assert.equal(parseDuration(45), 45);
  assert.equal(parseDuration(undefined), 30); // 기본 30분
});

test('at 이 있으면 시각이 살아있는 이벤트를 만든다', () => {
  const e = companionEvent(base);
  assert.equal(e.start.dateTime, '2026-09-20T22:30:00');
  assert.equal(e.end.dateTime, '2026-09-20T23:00:00');
  assert.equal(e.start.timeZone, 'Asia/Seoul');
  assert.equal(e.summary, '노트북 반품하기');
  assert.match(e.description, /https:\/\/nzassist\.pages\.dev\/t\/task-1\?list=list-1/);
});

test('소요시간 메타가 종료 시각을 바꾼다', () => {
  const e = companionEvent({ ...base, at: '09:00', meta: { dur: '1h30m' } });
  assert.equal(e.end.dateTime, '2026-09-20T10:30:00');
});

test('종료가 자정을 넘으면 23:59로 자른다', () => {
  // 22:30 + 90분 = 24:00 → 이벤트가 다음 날로 넘어가지 않게 막는다
  const e = companionEvent({ ...base, meta: { dur: '1h30m' } });
  assert.equal(e.end.dateTime, '2026-09-20T23:59:00');
});

test('기본 알림은 정시 popup', () => {
  assert.deepEqual(companionEvent(base).reminders,
    { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] });
});

test('task를 되짚을 수 있게 표시한다', () => {
  const p = companionEvent(base).extendedProperties.private;
  assert.equal(p.nz_app, 'nzassist');
  assert.equal(p.nz_task, 'task-1');
  assert.equal(p.nz_list, 'list-1');
  assert.equal(isCompanion(companionEvent(base)), true);
  assert.equal(isCompanion({ summary: '남의 일정' }), false);
});

test('at 이나 due 가 없으면 알람을 걸 수 없다', () => {
  assert.equal(companionEvent({ ...base, at: null }), null);
  assert.equal(companionEvent({ ...base, due: null }), null);
});

// --- syncCompanion: 가짜 캘린더로 동작 확인 ---
const fakeCal = () => {
  const calls = [];
  return {
    calls,
    insertEvent: async (c, e) => { calls.push(['insert', e]); return { id: 'evt-new' }; },
    patchEvent: async (c, id, e) => { calls.push(['patch', id, e]); return { id }; },
    deleteEvent: async (c, id) => { calls.push(['delete', id]); }
  };
};

test('시각을 처음 넣으면 이벤트를 만든다', async () => {
  const cal = fakeCal();
  const r = await syncCompanion(cal, base);
  assert.equal(r.gcal, 'evt-new');
  assert.equal(cal.calls[0][0], 'insert');
});

test('이미 있으면 갱신한다', async () => {
  const cal = fakeCal();
  const r = await syncCompanion(cal, { ...base, meta: { gcal: 'evt-1' } });
  assert.equal(r.gcal, 'evt-1');
  assert.equal(cal.calls[0][0], 'patch');
});

test('시각을 지우면 이벤트를 삭제한다', async () => {
  const cal = fakeCal();
  const r = await syncCompanion(cal, { ...base, at: null, meta: { gcal: 'evt-1' } });
  assert.equal(r.gcal, null);
  assert.deepEqual(cal.calls[0], ['delete', 'evt-1']);
});

test('완료하면 알람을 치운다', async () => {
  const cal = fakeCal();
  const r = await syncCompanion(cal, { ...base, completed: true, meta: { gcal: 'evt-1' } });
  assert.equal(r.gcal, null);
  assert.equal(cal.calls[0][0], 'delete');
});

test('사람이 캘린더에서 지웠으면 다시 만든다', async () => {
  const cal = fakeCal();
  cal.patchEvent = async () => { throw new Error('404 not found'); };
  const r = await syncCompanion(cal, { ...base, meta: { gcal: 'evt-gone' } });
  assert.equal(r.gcal, 'evt-new');
});

test('시각도 이벤트도 없으면 아무것도 하지 않는다', async () => {
  const cal = fakeCal();
  const r = await syncCompanion(cal, { ...base, at: null });
  assert.equal(r.changed, false);
  assert.equal(cal.calls.length, 0);
});
