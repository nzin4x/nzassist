import test from 'node:test';
import assert from 'node:assert/strict';
import { nextDue, addInterval, parseInterval } from '../src/repeat.js';

test('간격 문자열 파싱', () => {
  assert.deepEqual(parseInterval('3mo'), { count: 3, unit: 'mo' });
  assert.deepEqual(parseInterval('18mo'), { count: 18, unit: 'mo' });
  assert.equal(parseInterval('이상한값'), null);
});

test('간격 더하기', () => {
  assert.equal(addInterval('2026-09-06', { count: 7, unit: 'd' }), '2026-09-13');
  assert.equal(addInterval('2026-09-06', { count: 2, unit: 'w' }), '2026-09-20');
  assert.equal(addInterval('2026-09-06', { count: 3, unit: 'mo' }), '2026-12-06');
  assert.equal(addInterval('2026-09-06', { count: 1, unit: 'y' }), '2027-09-06');
});

test('월 이동은 말일을 클램프한다', () => {
  assert.equal(addInterval('2026-01-31', { count: 1, unit: 'mo' }), '2026-02-28');
});

// TODO.md의 핵심 검증 시나리오
test('every! 3 month — 1개월 지연 완료하면 완료일 + 3개월', () => {
  const next = nextDue({
    rep: '3mo',
    mode: 'after',
    previousDue: '2026-09-06',        // 원래 예정일
    completedAt: '2026-10-06T05:00:00.000Z' // 한 달 늦게 완료
  });
  // 원래 스케줄 기준이면 2026-12-06 (= 남은 2개월). 완료 기준이면 2027-01-06.
  assert.equal(next, '2027-01-06');
});

test('every 3 month — 지연 완료해도 원래 스케줄을 지킨다', () => {
  const next = nextDue({
    rep: '3mo',
    mode: 'fixed',
    previousDue: '2026-09-06',
    completedAt: '2026-10-06T05:00:00.000Z'
  });
  assert.equal(next, '2026-12-06');
});

test('고정 스케줄이 여러 회차 밀렸으면 오늘 이후로 따라잡는다', () => {
  const next = nextDue({
    rep: '7d',
    mode: 'fixed',
    previousDue: '2026-09-06',
    completedAt: '2026-10-06T05:00:00.000Z' // 30일 방치
  });
  assert.ok(next > '2026-10-06', `${next} 가 완료일보다 뒤여야 한다`);
  assert.equal(next, '2026-10-11'); // 09-06 + 7d씩 밀어 완료일 다음
});

test('완료 기준인데 완료 시각이 없으면 이전 due를 쓴다', () => {
  assert.equal(nextDue({ rep: '1mo', mode: 'after', previousDue: '2026-09-06' }), '2026-10-06');
});

test('완료 시각은 Asia/Seoul 벽시계로 해석한다', () => {
  // 2026-10-06T20:00Z = 한국시간 10/07 05:00 → 완료일은 10월 7일이다
  assert.equal(
    nextDue({ rep: '1d', mode: 'after', completedAt: '2026-10-06T20:00:00.000Z' }),
    '2026-10-08'
  );
});

test('간격이 이상하면 이전 due를 유지한다', () => {
  assert.equal(nextDue({ rep: '???', mode: 'after', previousDue: '2026-09-06' }), '2026-09-06');
});
