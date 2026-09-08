import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSnooze } from '../src/snooze.js';

const opts = now => ({ now, offsetMin: 540, defaultTime: '09:00' });

// 수요일 15:00
const WED_1500 = new Date('2026-09-09T15:00:00+09:00');

test('10분/30분/1시간/2시간 후 — 분 단위까지 정확히 옮긴다', () => {
  assert.equal(resolveSnooze('10분 후', opts(WED_1500)).dateTime, '2026-09-09T15:10:00');
  assert.equal(resolveSnooze('30분 후', opts(WED_1500)).dateTime, '2026-09-09T15:30:00');
  assert.equal(resolveSnooze('1시간 후', opts(WED_1500)).dateTime, '2026-09-09T16:00:00');
  assert.equal(resolveSnooze('2시간 후', opts(WED_1500)).dateTime, '2026-09-09T17:00:00');
});

test('시간 단위가 자정을 넘으면 날짜도 넘어간다', () => {
  const lateNight = new Date('2026-09-09T23:50:00+09:00');
  assert.equal(resolveSnooze('30분 후', opts(lateNight)).dateTime, '2026-09-10T00:20:00');
});

test('퇴근 후 — 18시 전이면 오늘 18시', () => {
  assert.equal(resolveSnooze('퇴근 후', opts(WED_1500)).dateTime, '2026-09-09T18:00:00');
});

test('퇴근 후 — 이미 18시가 지났으면 내일 18시', () => {
  const evening = new Date('2026-09-09T19:00:00+09:00');
  assert.equal(resolveSnooze('퇴근 후', opts(evening)).dateTime, '2026-09-10T18:00:00');
});

test('내일 아침 — 기본 시각(09:00) 적용', () => {
  assert.equal(resolveSnooze('내일 아침', opts(WED_1500)).dateTime, '2026-09-10T09:00:00');
});

test('주말 아침 — 다가오는 토요일 09:00', () => {
  // 오늘 수요일(9/9) -> 이번주 토요일(9/12)
  assert.equal(resolveSnooze('주말 아침', opts(WED_1500)).dateTime, '2026-09-12T09:00:00');
});

test('주말 아침 — 이미 이번주 토요일 09시가 지났으면 다음 토요일', () => {
  const satAfternoon = new Date('2026-09-12T15:00:00+09:00'); // 토요일 오후
  assert.equal(resolveSnooze('주말 아침', opts(satAfternoon)).dateTime, '2026-09-19T09:00:00');
});

test('다음주 아침 — 다음 달력주 월요일 09:00', () => {
  // 오늘 수요일(9/9) -> 이번주 월요일은 9/7(지남) -> 다음주 월요일 9/14
  assert.equal(resolveSnooze('다음주 아침', opts(WED_1500)).dateTime, '2026-09-14T09:00:00');
});

test('다음주 아침 — 오늘이 일요일이어도 내일(월요일)이 아니라 그 다음주 월요일', () => {
  const sunday = new Date('2026-09-13T10:00:00+09:00'); // 일요일
  assert.equal(resolveSnooze('다음주 아침', opts(sunday)).dateTime, '2026-09-14T09:00:00'); // 바로 내일
});

test('커스텀 상대값: 10m', () => {
  assert.equal(resolveSnooze('10m', opts(WED_1500)).dateTime, '2026-09-09T15:10:00');
});

test('커스텀 상대값: 2d', () => {
  assert.equal(resolveSnooze('2d', opts(WED_1500)).dateTime.slice(0, 10), '2026-09-11');
});

test('커스텀 상대값: 1h', () => {
  assert.equal(resolveSnooze('1h', opts(WED_1500)).dateTime, '2026-09-09T16:00:00');
});

test('커스텀 절대값: "내일 9시" — 기존 자연어 파서로 떨어진다', () => {
  assert.equal(resolveSnooze('내일 9시', opts(WED_1500)).dateTime, '2026-09-10T09:00:00');
});

test('커스텀 절대값: "다음주 토요일 7시"', () => {
  assert.equal(resolveSnooze('다음주 토요일 7시', opts(WED_1500)).dateTime, '2026-09-19T07:00:00');
});

test('빈 문자열이나 이상한 입력도 자연어 파서로 넘어가 기본 시각을 낸다', () => {
  const r = resolveSnooze('', opts(WED_1500));
  assert.ok(r.dateTime); // 최소한 죽지는 않는다
});
