import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';
import { toEvent, readProps, propFilter } from '../src/event.js';

const NOW = new Date('2026-09-06T10:00:00+09:00');
const build = (text, opts) => toEvent(parse(text, { now: NOW }), { shortId: 'k3f9x2', ...opts });

test('고정 반복은 RRULE이 붙는다', () => {
  const e = build('정수기필터 교체 every 18 months at 23:59');
  assert.deepEqual(e.recurrence, ['RRULE:FREQ=MONTHLY;INTERVAL=18']);
  assert.equal(e.start.dateTime, '2026-09-06T23:59:00');
  assert.equal(e.start.timeZone, 'Asia/Seoul');
});

test('완료 기준 반복은 RRULE 없이 단발 이벤트다', () => {
  const e = build('가습기 청소 every! 2 weeks');
  assert.equal(e.recurrence, undefined);
  const p = readProps(e);
  assert.equal(p.rep, '2w');
  assert.equal(p.rep_mode, 'after');
});

test('메타데이터는 title이 아니라 extendedProperties로 간다', () => {
  const e = build('이불 빨기 #주말 @집안일 every! 7 days 07:00');
  assert.equal(e.summary, '이불 빨기 #주말'); // @집안일은 제거, #주말은 유지
  assert.match(JSON.stringify(e.summary), /주말/);
  assert.doesNotMatch(e.summary, /nz_|rep|@/);
  const p = readProps(e);
  assert.equal(p.context, '집안일');
  assert.equal(p.tags, '주말');
  assert.equal(p.short_id, 'k3f9x2');
});

test('원본 문장을 보존한다', () => {
  const e = build('가습기 청소 every! 2 weeks');
  assert.equal(readProps(e).raw, '가습기 청소 every! 2 weeks');
});

test('완료 링크가 본문 맨 위에 붙는다', () => {
  const e = build('노트북 반품하기 19:00', { baseUrl: 'https://nzassist.pages.dev/' });
  assert.match(e.description, /^✅ 완료하기 → https:\/\/nzassist\.pages\.dev\/t\/k3f9x2\?done=1/);
});

test('baseUrl이 없으면 본문을 만들지 않는다', () => {
  assert.equal(build('노트북 반품하기 19:00').description, undefined);
});

test('기본 알림은 정시 popup 하나', () => {
  const e = build('노트북 반품하기 19:00');
  assert.deepEqual(e.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] });
});

test('알림 개수와 오프셋 한도를 강제한다', () => {
  assert.throws(() => build('x 19:00', { reminderMinutes: [0, 1, 2, 3, 4, 5] }), /최대 5개/);
  assert.throws(() => build('x 19:00', { reminderMinutes: [40321] }), /0~40320/);
  assert.throws(() => build('x 19:00', { reminderMinutes: [-1] }), /0~40320/);
});

test('마이그레이션 출처를 extra로 실어 보낸다', () => {
  const e = build('가습기 청소 every! 2 weeks', {
    extra: { src: 'todoist', src_id: '6X4rfFVPjhLf0PjW', priority: 4 }
  });
  const p = readProps(e);
  assert.equal(p.src, 'todoist');
  assert.equal(p.src_id, '6X4rfFVPjhLf0PjW');
  assert.equal(p.priority, '4'); // 값은 항상 문자열
});

test('빈 값은 속성으로 만들지 않는다', () => {
  const e = build('그냥 할일 19:00');
  const p = readProps(e);
  assert.equal(p.context, undefined);
  assert.equal(p.rep, undefined);
});

test('propFilter는 events.list 쿼리 형태를 만든다', () => {
  assert.equal(propFilter('src_id', 'abc'), 'nz_src_id=abc');
  assert.equal(propFilter('nz_src_id', 'abc'), 'nz_src_id=abc');
});

test('1024자를 넘는 값은 잘라서 담는다', () => {
  const e = build('x 19:00', { extra: { raw: 'A'.repeat(2000) } });
  assert.equal(readProps(e).raw.length, 1024);
});
