import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SESSION_COOKIE = 'nzassist_session';
const STATE_COOKIE = 'nzassist_oauth_state';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const STATE_MAX_AGE = 600;
const SCOPE = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar'
].join(' ');

const base64url = value => Buffer.from(value).toString('base64url');
const fromBase64url = value => Buffer.from(value, 'base64url');
const hash = value => createHash('sha256').update(value).digest();
const cookie = (name, value, options = {}) => {
  // The PWA and Lambda use different origins; SameSite=None is required for credentialed API fetches.
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=None'];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join('; ');
};

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part.trim(), ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([name]) => name));
}

export function encryptSession(session, secret) {
  if (!secret) throw new Error('OAUTH_SESSION_SECRET가 필요합니다.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', hash(secret), iv);
  const body = Buffer.from(JSON.stringify({ ...session, iat: Date.now() }), 'utf8');
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(base64url).join('.');
}

export function decryptSession(value, secret) {
  if (!value || !secret) return null;
  try {
    const [iv, tag, encrypted] = value.split('.').map(fromBase64url);
    const decipher = createDecipheriv('aes-256-gcm', hash(secret), iv);
    decipher.setAuthTag(tag);
    const session = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
    if (!session.iat || Date.now() - session.iat > SESSION_MAX_AGE * 1000) return null;
    return session;
  } catch {
    return null;
  }
}

function redirectUri(env) {
  return env.GOOGLE_OAUTH_REDIRECT_URI || `${env.API_PUBLIC_URL || env.LAMBDA_FUNCTION_URL || ''}/auth/google/callback`;
}

function appUrl(env, path = '/') {
  return `${(env.PWA_BASE_URL || 'https://assist.nz.pe.kr').replace(/\/$/, '')}${path}`;
}

export function oauthStart(env, fetchImpl = fetch) {
  const state = base64url(randomBytes(24));
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return {
    statusCode: 302,
    headers: {
      location: `${AUTH_URL}?${params}`
    },
    cookies: [cookie(STATE_COOKIE, state, { maxAge: STATE_MAX_AGE })],
    body: ''
  };
}

export async function oauthCallback({ env, query, cookies, fetchImpl = fetch }) {
  if (query.error) return { statusCode: 400, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: `Google 로그인 취소: ${query.error}` };
  if (!query.code || !query.state || !cookies[STATE_COOKIE] || !safeEqual(query.state, cookies[STATE_COOKIE])) {
    return { statusCode: 400, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'OAuth state가 유효하지 않습니다.' };
  }

  const tokenResponse = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: query.code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri(env),
      grant_type: 'authorization_code'
    })
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.refresh_token) throw new Error(`Google token exchange failed: ${token.error_description || token.error || 'refresh token 없음'}`);

  const userResponse = await fetchImpl(USERINFO_URL, { headers: { authorization: `Bearer ${token.access_token}` } });
  const user = await userResponse.json();
  if (!userResponse.ok || !user.sub) throw new Error('Google 사용자 정보를 가져오지 못했습니다.');

  const session = encryptSession({
    refreshToken: token.refresh_token,
    sub: user.sub,
    email: user.email || '',
    name: user.name || user.email || ''
  }, env.OAUTH_SESSION_SECRET);
  return {
    statusCode: 302,
    headers: {
      location: appUrl(env)
    },
    cookies: [cookie(SESSION_COOKIE, session, { maxAge: SESSION_MAX_AGE }), cookie(STATE_COOKIE, '', { maxAge: 0 })],
    body: ''
  };
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const sessionCookieName = SESSION_COOKIE;
export const sessionMaxAge = SESSION_MAX_AGE;
export const clearSessionCookie = () => cookie(SESSION_COOKIE, '', { maxAge: 0 });
export const getSession = (headers, env) => decryptSession(parseCookies(headers?.cookie || headers?.Cookie || '')[SESSION_COOKIE], env.OAUTH_SESSION_SECRET);
export const getStateCookies = (headers, cookies = []) => {
  const headerCookies = parseCookies(headers?.cookie || headers?.Cookie || '');
  const eventCookies = Array.isArray(cookies) ? parseCookies(cookies.join('; ')) : {};
  return { ...headerCookies, ...eventCookies };
};
export const scope = SCOPE;
