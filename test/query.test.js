import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, matches, search } from '../src/query.js';

const NOW = new Date('2026-09-07T12:00:00Z').getTime();
const hoursAgo = h => new Date(NOW - h * 3_600_000).toISOString();
const daysAgo = d => new Date(NOW - d * 86_400_000).toISOString();

const task = (over = {}) => ({
  title: '영수증 정리하기', tags: ['집안일', '급함'], context: '회사',
  updatedAt: hoursAgo(2), createdAt: daysAgo(5), ...over
});

test('빈 질의는 전부 통과', () => {
  assert.equal(matches(parseQuery(''), task()), true);
  assert.equal(matches(parseQuery('   '), task()), true);
});

test('자유단어는 제목 부분일치, 대소문자 무시', () => {
  assert.equal(search('영수증', task()), true);
  assert.equal(search('정리', task()), true);
  assert.equal(search('없는단어', task()), false);
});

test('#tag 검색', () => {
  assert.equal(search('#집안일', task()), true);
  assert.equal(search('#급함', task()), true);
  assert.equal(search('#없음', task()), false);
});

test('@context 검색', () => {
  assert.equal(search('@회사', task()), true);
  assert.equal(search('@집', task()), false);
});

test('연속된 항은 암묵적으로 AND', () => {
  assert.equal(search('#집안일 @회사', task()), true);
  assert.equal(search('#집안일 @집', task()), false);
  assert.equal(search('영수증 #집안일 @회사', task()), true);
});

test('명시적 or', () => {
  assert.equal(search('#없음 or @회사', task()), true);
  assert.equal(search('#없음 or @집', task()), false);
});

test('명시적 and는 암묵적 and와 같다', () => {
  assert.equal(search('#집안일 and @회사', task()), true);
});

test('괄호로 우선순위 조정', () => {
  const t = task({ tags: ['급함'] });
  assert.equal(search('(#집안일 or #급함) and @회사', t), true);
  assert.equal(search('#집안일 or (#급함 and @집)', t), false);
});

test('not', () => {
  assert.equal(search('not #없음', task()), true);
  assert.equal(search('not #집안일', task()), false);
});

test('updated < 1d — 2시간 전 갱신은 하루 이내', () => {
  assert.equal(matches(parseQuery('updated < 1d'), task(), NOW), true);
});

test('updated < 1h — 2시간 전 갱신은 1시간 이내가 아니다', () => {
  assert.equal(matches(parseQuery('updated < 1h'), task(), NOW), false);
});

test('created < 10d — 5일 전 생성은 10일 이내', () => {
  assert.equal(matches(parseQuery('created < 10d'), task(), NOW), true);
});

test('created > 10d — 5일 전 생성은 10일 초과가 아니다', () => {
  assert.equal(matches(parseQuery('created > 10d'), task(), NOW), false);
});

test('<= / >= 도 지원', () => {
  const t = task({ updatedAt: hoursAgo(24) }); // 정확히 1일 전
  assert.equal(matches(parseQuery('updated <= 1d'), t, NOW), true);
  assert.equal(matches(parseQuery('updated < 1d'), t, NOW), false);
});

test('updatedAt/createdAt이 없으면 비교는 거짓', () => {
  assert.equal(matches(parseQuery('updated < 1d'), task({ updatedAt: null }), NOW), false);
});

test('복합: 태그 + 기간 + 또는', () => {
  const t = task();
  assert.equal(search('#집안일 and updated < 1d or @없음', t), true);
});

test('닫는 괄호가 없으면 에러', () => {
  assert.throws(() => parseQuery('(#집안일'));
});

test('실전 예시: 하루 안에 바뀐 급함 태그', () => {
  assert.equal(search('#급함 and updated < 1d', task()), true);
  assert.equal(search('#급함 and updated < 1d', task({ updatedAt: daysAgo(3) })), false);
});
