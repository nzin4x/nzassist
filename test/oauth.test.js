import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptSession, encryptSession, getStateCookies, oauthCallback, oauthStart, parseCookies } from '../src/oauth.js';

const env = {
  GOOGLE_OAUTH_CLIENT_ID: 'client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://api.example.com/auth/google/callback',
  OAUTH_SESSION_SECRET: 'a sufficiently long test secret'
};

test('세션은 암호화 후 복호화된다', () => {
  const value = encryptSession({ sub: 'google-sub', email: 'user@example.com', refreshToken: 'refresh' }, env.OAUTH_SESSION_SECRET);
  assert.notEqual(value.includes('refresh'), true);
  const session = decryptSession(value, env.OAUTH_SESSION_SECRET);
  assert.deepEqual({ sub: session.sub, email: session.email, refreshToken: session.refreshToken }, {
    sub: 'google-sub', email: 'user@example.com', refreshToken: 'refresh'
  });
  assert.equal(typeof session.iat, 'number');
});

test('변조된 세션은 거부한다', () => {
  const value = encryptSession({ sub: 'google-sub' }, env.OAUTH_SESSION_SECRET);
  const parts = value.split('.');
  const tag = Buffer.from(parts[1], 'base64url');
  tag[0] ^= 1;
  parts[1] = tag.toString('base64url');
  const tampered = parts.join('.');
  assert.equal(decryptSession(tampered, env.OAUTH_SESSION_SECRET), null);
});

test('헤더와 Lambda cookies 배열을 파싱한다', () => {
  assert.deepEqual(parseCookies('a=one; nzassist_oauth_state=two%20words'), { a: 'one', nzassist_oauth_state: 'two words' });
  assert.deepEqual(getStateCookies({ cookie: 'a=one' }, ['nzassist_oauth_state=abc']), { a: 'one', nzassist_oauth_state: 'abc' });
});

test('OAuth 시작은 Google consent URL과 state 쿠키를 만든다', () => {
  const response = oauthStart(env);
  assert.equal(response.statusCode, 302);
  assert.match(response.headers.location, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.equal(response.cookies.length, 1);
  const url = new URL(response.headers.location);
  assert.equal(url.searchParams.get('redirect_uri'), env.GOOGLE_OAUTH_REDIRECT_URI);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('scope').includes('tasks'), true);
});

test('OAuth callback은 state가 다르면 token endpoint를 호출하지 않는다', async () => {
  let called = false;
  const response = await oauthCallback({
    env,
    query: { code: 'code', state: 'wrong' },
    cookies: { nzassist_oauth_state: 'right' },
    fetchImpl: async () => { called = true; }
  });
  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
});
