// TODO.md §4-4 회귀 케이스. 실제 Todoist export에서 가져온 문장들이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';

const NOW = new Date('2026-09-06T10:00:00+09:00');
const p = text => parse(text, { now: NOW });

// 벽시계 기준 요일. UTC로 변환하면 아침 시각이 전날로 넘어가므로 날짜 부분만 본다.
const dow = iso => new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();

test('시각만 주면 오늘로 잡는다', () => {
  const r = p('노트북 반품하기 19:00');
  assert.equal(r.title, '노트북 반품하기');
  assert.equal(r.start.dateTime, '2026-09-06T19:00:00');
  assert.equal(r.end.dateTime, '2026-09-06T19:30:00');
});

test('지난 날짜는 내년으로 넘긴다', () => {
  const r = p('@미혜 불꽃놀이 9/5');
  assert.equal(r.context, '미혜');
  assert.equal(r.title, '불꽃놀이');
  assert.equal(r.start.dateTime, '2027-09-05T09:00:00'); // 기본 시각 09:00
});

test('시각을 안 주면 기본 09:00 — 단, 오늘 09:00이 지났으면 내일', () => {
  // NOW가 10:00이므로 오늘 09:00은 이미 지났다
  const r = p('가습기 청소 clean humidifiers every! 2 weeks');
  assert.equal(r.start.dateTime, '2026-09-07T09:00:00');
});

test('every! 는 완료 기준이라 RRULE이 없다', () => {
  const r = p('가습기 청소 clean humidifiers every! 2 weeks');
  assert.equal(r.title, '가습기 청소 clean humidifiers');
  assert.deepEqual(
    { interval: r.repeat.interval, mode: r.repeat.mode, rrule: r.repeat.rrule },
    { interval: '2w', mode: 'after', rrule: null }
  );
});

test('#tag는 title에 남고 tags에도 모인다', () => {
  const r = p('정수기필터 1단계 세디먼트 필터 (빨간) 3~6개월 기본필터 (개별통수 2L) #청소 #휴일 every! 4 month');
  assert.deepEqual(r.tags, ['청소', '휴일']);
  assert.match(r.title, /#청소 #휴일/);
  assert.equal(r.repeat.interval, '4mo');
  assert.equal(r.repeat.mode, 'after');
});

test('every N months at HH:MM — 고정 반복 + 시각', () => {
  const r = p('정수기필터 3단계 중공사막UF 멤브레인 필터 (초록) 18개월 (개별통수 6L) #청소 #휴일 every 18 months at 23:59');
  assert.equal(r.repeat.mode, 'fixed');
  assert.equal(r.repeat.interval, '18mo');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=MONTHLY;INTERVAL=18');
  assert.equal(r.start.dateTime, '2026-09-06T23:59:00');
  assert.match(r.title, /18개월/); // 제목 속 "18개월"은 반복으로 오해되지 않는다
});

test('every! N days HH:MM', () => {
  const r = p('이불 베개 빨기 #주말 every! 7 days 07:00');
  assert.equal(r.repeat.interval, '7d');
  assert.equal(r.repeat.mode, 'after');
  assert.equal(r.start.dateTime, '2026-09-07T07:00:00'); // 오늘 07:00은 지났다
});

test('제목 속 every는 반복으로 오해되지 않는다', () => {
  const r = p('clean air conditioner every ends of summer every year');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=YEARLY');
  assert.match(r.title, /every ends of summer/);
});

test('every 10 oct — 매년 특정 날짜', () => {
  const r = p('🧽 clean and 📦 pack fans ☢️ into storage every 10 oct');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=YEARLY');
  assert.equal(r.start.dateTime, '2026-10-10T09:00:00');
  assert.match(r.title, /🧽 clean and 📦 pack fans ☢️ into storage/);
});

test('every saturday HH:MM — 따옴표와 이모지를 보존한다', () => {
  const r = p('👨‍🍳 clean the "air-fryer" and "microwave" (inside with boiled water 💦) every saturday 14:00');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=WEEKLY;BYDAY=SA');
  assert.equal(dow(r.start.dateTime), 6);
  assert.match(r.start.dateTime, /T14:00:00$/);
  assert.match(r.title, /"air-fryer".*"microwave"/);
  assert.match(r.title, /👨‍🍳/);
});

test('한국어: 토요일 마다 7시30분', () => {
  const r = p('💐🚿 watering the flowers #housework #weekends 토요일 마다 7시30분');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=WEEKLY;BYDAY=SA');
  assert.equal(dow(r.start.dateTime), 6);
  assert.match(r.start.dateTime, /T07:30:00$/);
});

test('한국어: 매년', () => {
  const r = p('겨울 ❄️ 화분 💐 들여놓기 매년');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=YEARLY');
  assert.equal(r.title, '겨울 ❄️ 화분 💐 들여놓기');
});

test('in 5 min — 기본 시각을 덮어쓰지 않는다', () => {
  const r = p('test todo in 5 min');
  assert.equal(r.title, 'test todo');
  assert.equal(r.start.dateTime, '2026-09-06T10:05:00');
});

test('in 3 days 09:00', () => {
  const r = p('test todo in 3 days 09:00');
  assert.equal(r.start.dateTime, '2026-09-09T09:00:00');
});

test('@가 2개면 첫 번째만 컨텍스트, 나머지는 #tag로 강등', () => {
  const r = p('xx 를 해야 한다 @회사>CMP @개인');
  assert.equal(r.context, '회사>CMP');
  assert.match(r.title, /#개인/);
  assert.ok(r.tags.includes('개인'));
  assert.ok(r.warnings.some(w => /@가 여러 개/.test(w)));
});

test('오후 표기', () => {
  const r = p('회의 오후 3시');
  assert.equal(r.start.dateTime, '2026-09-06T15:00:00');
});

test('내일', () => {
  const r = p('내일 세탁소 들르기');
  assert.equal(r.start.dateTime, '2026-09-07T09:00:00');
});

test('월 이동은 말일을 클램프한다', () => {
  const r = parse('정수기 필터 갈기 every! 1 month', { now: new Date('2026-01-31T10:00:00+09:00') });
  assert.equal(r.repeat.interval, '1mo');
});

test('YYYY-MM-DD', () => {
  const r = p('건강검진 2026-11-20 14:00');
  assert.equal(r.start.dateTime, '2026-11-20T14:00:00');
});

// --- 실제 Todoist 계정에서 나온 반복 문장들 (scripts/todoist-export.mjs 결과) ---

test('every! M/D — 완료 기준 연간 반복', () => {
  const r = p('건강검진 every! 7/5');
  assert.equal(r.repeat.mode, 'after');
  assert.equal(r.repeat.rrule, null);
  assert.equal(r.start.dateTime, '2027-07-05T09:00:00'); // 7/5는 지났으므로 내년
});

test('매일 7시', () => {
  const r = p('🍾 spread minoxidil morning 매일 7시');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=DAILY');
  assert.equal(r.start.dateTime, '2026-09-07T07:00:00'); // 오늘 07:00은 지났다
});

test('every day 7am — am/pm 표기', () => {
  const r = p('🍎 과일야채 🥬 every day 7am');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=DAILY');
  assert.match(r.start.dateTime, /T07:00:00$/);
});

test('ev day 7 pm — every 축약형', () => {
  const r = p('약 먹기 ev day 7 pm');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=DAILY');
  assert.match(r.start.dateTime, /T19:00:00$/);
});

test('2주후에 — 한국어 상대 표현', () => {
  const r = p('🧊 cleaning fridge 2주후에');
  assert.equal(r.start.dateTime, '2026-09-20T09:00:00');
  assert.match(r.title, /cleaning fridge/);
});

test('매월 25일 — BYMONTHDAY', () => {
  const r = p('카드값 확인 매월 25일');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=MONTHLY;BYMONTHDAY=25');
  assert.equal(r.start.dateTime, '2026-09-25T09:00:00');
});

test('every sun at 08:00 — 요일 축약형', () => {
  const r = p('주간 회고 every sun at 08:00');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=WEEKLY;BYDAY=SU');
  assert.equal(dow(r.start.dateTime), 0);
  assert.match(r.start.dateTime, /T08:00:00$/);
});

test('매! 30일 — 한국어 완료 기준 반복', () => {
  const r = p('정수기 점검 매! 30일');
  assert.equal(r.repeat.interval, '30d');
  assert.equal(r.repeat.mode, 'after');
  assert.equal(r.repeat.rrule, null);
});

test('every! year — 숫자 없는 완료 기준 반복', () => {
  const r = p('자동차 보험 갱신 every! year');
  assert.equal(r.repeat.interval, '1y');
  assert.equal(r.repeat.mode, 'after');
});

test('every 28th dec — 서수 표기', () => {
  const r = p('연말 정산 준비 every 28th dec');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=YEARLY');
  assert.equal(r.start.dateTime, '2026-12-28T09:00:00');
});

test('every! 1 month 21:20 — 완료 기준 + 시각', () => {
  const r = p('렌즈 세척 every! 1 month 21:20');
  assert.equal(r.repeat.interval, '1mo');
  assert.equal(r.repeat.mode, 'after');
  assert.equal(r.start.dateTime, '2026-09-06T21:20:00');
});

test('every 10th — 매월 N일 (월 이름 없는 서수)', () => {
  const r = p('뉴전 사업소득세 신고 every 10th');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=MONTHLY;BYMONTHDAY=10');
  assert.equal(r.start.dateTime, '2026-09-10T09:00:00');
});

test('every! 10th 09:00 — 서수 + 완료 기준', () => {
  const r = p('스픽 어학컨텐츠 신청 every! 10th 09:00');
  assert.equal(r.repeat.mode, 'after');
  assert.equal(r.repeat.rrule, null);
  assert.equal(r.start.dateTime, '2026-09-10T09:00:00');
});

test('every 1st day 09:00', () => {
  const r = p('bills review every 1st day 09:00');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=MONTHLY;BYMONTHDAY=1');
});

test('every! workday — 평일 반복', () => {
  const r = p('code review ! every! workday 11:00');
  assert.equal(r.repeat.interval, '1w');
  assert.equal(r.repeat.mode, 'after');
  assert.equal(r.repeat.byday, 'MO,TU,WE,TH,FR');
  assert.match(r.start.dateTime, /T11:00:00$/);
});

test('every 3-1 — 하이픈 날짜', () => {
  const r = p('연말 정산 서류 재계산 every 3-1');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=YEARLY');
  assert.equal(r.start.dateTime, '2027-03-01T09:00:00'); // 3/1은 지났으므로 내년
});

test('7월25일마다 — 한국어 연간 날짜', () => {
  const r = p('상반기 재산세 확인 7월25일마다');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=YEARLY');
  assert.equal(r.start.dateTime, '2027-07-25T09:00:00');
});

test('매마지막날 — 말일 반복', () => {
  const r = p('Star 입력 매마지막날');
  assert.equal(r.repeat.rrule, 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1');
  assert.equal(r.start.dateTime, '2026-09-30T09:00:00');
});

test('2주후에 — 상대 간격을 노출해 마이그레이션이 승격할 수 있게 한다', () => {
  const r = p('🧊 cleaning fridge 2주후에');
  assert.equal(r.repeat, null);
  assert.equal(r.relativeInterval.interval, '2w');
});

// --- 지난 시각은 알림을 걸 수 없다: 날짜를 안 줬으면 다음 날로 넘긴다 ---

const NIGHT = new Date('2026-09-07T22:20:00+09:00'); // 밤 10시 20분
const night = text => parse(text, { now: NIGHT });

test('밤 10시에 "20:00" 은 내일 저녁 8시를 뜻한다', () => {
  const r = night('약 먹기 20:00');
  assert.equal(r.start.dateTime, '2026-09-08T20:00:00');
  assert.match(r.warnings[0], /지났으므로 내일/);
});

test('아직 안 지난 시각은 오늘 그대로', () => {
  const r = night('약 먹기 23:00');
  assert.equal(r.start.dateTime, '2026-09-07T23:00:00');
  assert.equal(r.warnings.length, 0);
});

test('시각을 안 줘도 기본 시각이 지났으면 내일로', () => {
  // 밤 10시 20분에 입력하면 오늘 09:00 은 이미 지났다
  assert.equal(night('세탁소 들르기').start.dateTime, '2026-09-08T09:00:00');
});

test('날짜를 명시하면 지난 시각이어도 그대로 따른다', () => {
  // 사용자가 분명히 그 날짜를 지정했으므로 존중한다
  assert.equal(night('회고 쓰기 2026-09-07 20:00').start.dateTime, '2026-09-07T20:00:00');
});

test('"내일" 처럼 날짜를 준 경우도 그대로', () => {
  assert.equal(night('내일 세탁소 08:00').start.dateTime, '2026-09-08T08:00:00');
});

test('오늘이 9/7일 때 "9/6" 은 내년을 뜻한다', () => {
  assert.equal(night('생일 챙기기 9/6').start.dateTime, '2027-09-06T09:00:00');
});

test('연도까지 명시한 과거 날짜는 그대로 둔다', () => {
  assert.equal(night('기록 정리 2026-09-06 10:00').start.dateTime, '2026-09-06T10:00:00');
});

test('in 5 min 은 항상 미래라 넘기지 않는다', () => {
  assert.equal(night('알림 테스트 in 5 min').start.dateTime, '2026-09-07T22:25:00');
});

test('9/7 22시에 "9/7 21:00" 은 내년을 뜻한다 (지난 알람은 없다)', () => {
  const r = night('회고 9/7 21:00');
  assert.equal(r.start.dateTime, '2027-09-07T21:00:00');
});

test('같은 날이라도 아직 안 지난 시각은 올해', () => {
  assert.equal(night('회고 9/7 23:30').start.dateTime, '2026-09-07T23:30:00');
});

test('연도를 쓰면 지난 시각이어도 그대로 (의도가 분명하다)', () => {
  assert.equal(night('회고 2026-09-07 21:00').start.dateTime, '2026-09-07T21:00:00');
});
