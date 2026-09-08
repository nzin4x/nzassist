import test from 'node:test';
import assert from 'node:assert/strict';
import { convert, readDue, readRepeat, withTags } from '../src/todoist.js';
import { readNotes, readMeta } from '../src/task.js';

const NOW = new Date('2026-09-07T10:00:00+09:00');

test('due.date의 세 가지 형태를 편다', () => {
  // floating + 시각 (92건)
  assert.deepEqual(readDue({ date: '2025-09-23T07:00:00' }), { date: '2025-09-23', time: '07:00' });
  // 날짜만 (53건) → 기본 시각
  assert.deepEqual(readDue({ date: '2024-11-30' }), { date: '2024-11-30', time: '09:00' });
  // UTC instant (4건) → Asia/Seoul 환산
  assert.deepEqual(readDue({ date: '2026-08-08T23:00:00Z' }), { date: '2026-08-09', time: '08:00' });
  // 날짜 없음 (53건)
  assert.deepEqual(readDue(undefined), { date: null, time: null });
});

test('반복은 due.string에서만 뽑는다', () => {
  assert.deepEqual(
    readRepeat({ is_recurring: true, string: 'every! 6 month' }, NOW),
    { interval: '6mo', mode: 'after', byday: undefined, monthday: undefined }
  );
  assert.equal(readRepeat({ is_recurring: false, string: '오늘' }, NOW), null);
});

test('"2주후에" 는 간격으로 승격된다', () => {
  const r = readRepeat({ is_recurring: true, string: '2주후에' }, NOW);
  assert.equal(r.interval, '2w');
  assert.equal(r.promoted, true);
});

test('라벨은 #tag로 제목에 붙는다 (D4)', () => {
  assert.equal(withTags('정수기필터 교체', ['청소', '휴일']), '정수기필터 교체 #청소 #휴일');
});

test('이미 제목에 있는 태그는 중복시키지 않는다', () => {
  assert.equal(withTags('정수기필터 #청소 교체', ['청소', '휴일']), '정수기필터 #청소 교체 #휴일');
});

test('실제 데이터: 매년 구강검진', () => {
  const { task } = convert({
    id: '6X4rfFVPjhLf0PjW',
    content: '😬 구강검진',
    description: '매년 구강검진 할 수 있도록 지원',
    labels: ['효근'],
    due: { date: '2026-07-05', string: 'every! 7/5', is_recurring: true },
    priority: 1
  }, { context: '자녀관리', batch: 'mig-1', now: NOW });

  assert.equal(task.title, '😬 구강검진 #효근');
  assert.equal(task.due, '2026-07-05T00:00:00.000Z');

  const { userNotes, meta } = readNotes(task.notes);
  assert.equal(userNotes, '매년 구강검진 할 수 있도록 지원');
  assert.equal(meta.at, '09:00');       // 날짜만 있었으므로 기본 시각
  assert.equal(meta.rep, '1y');
  assert.equal(meta.rep_mode, 'after'); // every! → 완료 기준
  assert.equal(meta.context, '자녀관리');
  assert.equal(meta.src_id, '6X4rfFVPjhLf0PjW');
  assert.equal(meta.batch, 'mig-1');
  assert.equal(meta.priority, undefined); // 기본 우선순위는 기록하지 않는다
});

test('시각이 있는 반복은 그대로 보존된다', () => {
  const { task } = convert({
    id: 'a1', content: '🍾 spread minoxidil morning',
    due: { date: '2025-09-23T07:00:00', string: '매일 7시', is_recurring: true },
    priority: 1
  }, { now: NOW });
  const meta = readMeta(task);
  assert.equal(meta.at, '07:00');
  assert.equal(meta.rep, '1d');
  assert.equal(task.due, '2025-09-23T00:00:00.000Z');
});

test('날짜 없는 task는 due 없이 만든다 (someday)', () => {
  const { task } = convert({ id: 'b1', content: '언젠가 할 일', priority: 1 }, { now: NOW });
  assert.equal(task.due, undefined);
  assert.equal('due' in task, false);
});

test('우선순위는 기본값이 아닐 때만 기록한다', () => {
  assert.equal(readMeta(convert({ id: 'c', content: 'x', priority: 4 }, { now: NOW }).task).priority, '4');
  assert.equal(readMeta(convert({ id: 'c', content: 'x', priority: 1 }, { now: NOW }).task).priority, undefined);
});

test('제목 속 숫자를 날짜로 오인하지 않는다', () => {
  // Todoist가 이미 날짜를 확정했으므로 제목을 다시 파싱하지 않는다
  const { task } = convert({
    id: 'd1',
    content: '정수기필터 3단계 중공사막UF 멤브레인 필터 (초록) 18개월 (개별통수 6L)',
    due: { date: '2026-12-01', string: 'every 18 months', is_recurring: true },
    priority: 1
  }, { now: NOW });
  assert.match(task.title, /18개월/);
  assert.equal(task.due, '2026-12-01T00:00:00.000Z');
  assert.equal(readMeta(task).rep, '18mo');
});

test('반복 문장을 못 읽으면 경고를 남긴다', () => {
  const { warnings } = convert({
    id: 'e1', content: 'x', due: { is_recurring: true, string: '알 수 없는 반복' }, priority: 1
  }, { now: NOW });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /못 읽음/);
});
