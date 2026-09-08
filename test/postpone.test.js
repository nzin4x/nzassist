import test from 'node:test';
import assert from 'node:assert/strict';
import { addInterval, parseInterval } from '../src/repeat.js';

// postpone 스펙 정규화는 api.js 내부 함수라 여기선 간격 계산만 검증
test('postpone 간격 계산', () => {
  assert.equal(addInterval('2026-09-07', parseInterval('1d')), '2026-09-08');
  assert.equal(addInterval('2026-09-07', parseInterval('2w')), '2026-09-21');
  assert.equal(addInterval('2026-09-07', parseInterval('3mo')), '2026-12-07');
  assert.equal(addInterval('2026-09-07', parseInterval('1h')), '2026-09-07'); // 시간은 날짜 불변
});
