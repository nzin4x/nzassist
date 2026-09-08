import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBearer } from '../src/auth.js';

test('토큰 미설정이면 항상 통과 (로컬 개발 기본값)', () => {
  assert.equal(checkBearer({}, undefined), true);
  assert.equal(checkBearer({ authorization: 'Bearer wrong' }, ''), true);
});

test('정확히 일치해야 통과', () => {
  assert.equal(checkBearer({ authorization: 'Bearer abc123' }, 'abc123'), true);
  assert.equal(checkBearer({ authorization: 'Bearer abc123' }, 'xyz'), false);
});

test('Bearer 대소문자와 공백을 허용한다', () => {
  assert.equal(checkBearer({ authorization: 'bearer   abc123  ' }, 'abc123'), true);
});

test('헤더가 대문자 Authorization으로 와도 잡는다 (Lambda 이벤트 형태)', () => {
  assert.equal(checkBearer({ Authorization: 'Bearer abc123' }, 'abc123'), true);
});

test('헤더가 없으면 실패', () => {
  assert.equal(checkBearer({}, 'abc123'), false);
  assert.equal(checkBearer(undefined, 'abc123'), false);
});
