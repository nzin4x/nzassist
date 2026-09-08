import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';
import { toTask, readNotes, writeNotes, readMeta, isManaged, toDue, scheduledAt, patchMeta, MARKER } from '../src/task.js';

const NOW = new Date('2026-09-06T10:00:00+09:00');
const p = text => parse(text, { now: NOW });

test('due는 날짜만 담고 시각은 메타의 at= 이 원본', () => {
  const t = toTask(p('노트북 반품하기 19:00'));
  assert.equal(t.due, '2026-09-06T00:00:00.000Z');
  assert.equal(readMeta(t).at, '19:00');
  assert.equal(scheduledAt(t), '2026-09-06T19:00:00');
});

test('사용자 메모와 메타 블록이 분리된다', () => {
  const notes = '싱크대에 락스 받아두기\n찬물로 (뜨신물 안됨)\n\n---nzassist---\nrep=1y\nrep_mode=fixed';
  const { userNotes, meta } = readNotes(notes);
  assert.equal(userNotes, '싱크대에 락스 받아두기\n찬물로 (뜨신물 안됨)');
  assert.deepEqual(meta, { rep: '1y', rep_mode: 'fixed' });
});

test('메타를 고쳐도 사용자 메모는 그대로다', () => {
  const task = { notes: '내 메모\n\n---nzassist---\nrep=1y\nat=09:00' };
  const patched = patchMeta(task, { at: '21:00' });
  const { userNotes, meta } = readNotes(patched.notes);
  assert.equal(userNotes, '내 메모');
  assert.equal(meta.at, '21:00');
  assert.equal(meta.rep, '1y'); // 건드리지 않은 값은 유지
});

test('nzassist가 모르는 메타 필드도 통과시킨다', () => {
  const task = { notes: '메모\n\n---nzassist---\nfuture_field=xyz\nat=09:00' };
  const patched = patchMeta(task, { at: '10:00' });
  assert.equal(readNotes(patched.notes).meta.future_field, 'xyz');
});

test('메타 블록이 없는 native task도 읽을 수 있다', () => {
  const { userNotes, meta } = readNotes('그냥 손으로 쓴 메모');
  assert.equal(userNotes, '그냥 손으로 쓴 메모');
  assert.deepEqual(meta, {});
});

test('빈 값은 메타에 쓰지 않는다', () => {
  const t = toTask(p('그냥 할일 19:00'));
  const meta = readMeta(t);
  assert.equal(meta.context, undefined);
  assert.equal(meta.rep, undefined);
  assert.equal(meta.app, 'nzassist');
});

test('관리 대상 판별 — 일괄 삭제와 normalizer의 기준', () => {
  assert.equal(isManaged(toTask(p('할일 19:00'))), true);
  assert.equal(isManaged({ notes: '손으로 쓴 메모' }), false);
  assert.equal(isManaged({}), false);
});

test('배치 id로 특정 마이그레이션분만 골라낼 수 있다', () => {
  const t = toTask(p('할일 19:00'), { batch: 'mig-20260907' });
  assert.equal(readMeta(t).batch, 'mig-20260907');
});

test('반복 정보가 메타로 넘어간다', () => {
  const t = toTask(p('정수기필터 every! 3 month'));
  const meta = readMeta(t);
  assert.equal(meta.rep, '3mo');
  assert.equal(meta.rep_mode, 'after');
});

test('요일/월일 반복 정보도 보존된다', () => {
  assert.equal(readMeta(toTask(p('회고 every sat at 08:00'))).rep_byday, 'SA');
  assert.equal(readMeta(toTask(p('카드값 매월 25일'))).rep_monthday, '25');
});

test('원본 문장을 보존한다', () => {
  assert.equal(readMeta(toTask(p('가습기 청소 every! 2 weeks'))).raw, '가습기 청소 every! 2 weeks');
});

test('사용자 메모를 함께 저장한다', () => {
  const t = toTask(p('에어컨 청소하기 19:00'), { userNotes: '- 락스 콸콸\n- 송풍 팬 분리' });
  const { userNotes, meta } = readNotes(t.notes);
  assert.equal(userNotes, '- 락스 콸콸\n- 송풍 팬 분리');
  assert.equal(meta.at, '19:00');
});

test('notes 8192자를 넘으면 메타를 지키고 사용자 메모를 자른다', () => {
  const t = toTask(p('할일 19:00'), { userNotes: 'A'.repeat(9000) });
  assert.ok(t.notes.length <= 8192);
  assert.ok(t.notes.includes(MARKER));
  assert.equal(readNotes(t.notes).meta.at, '19:00');
});

test('메타가 비면 마커를 쓰지 않는다', () => {
  assert.equal(writeNotes('메모만', {}), '메모만');
});

test('toDue는 어떤 형식이든 날짜만 남긴다', () => {
  assert.equal(toDue('2026-09-06T19:00:00'), '2026-09-06T00:00:00.000Z');
  assert.equal(toDue('2026-09-06'), '2026-09-06T00:00:00.000Z');
});
