// AWS Lambda 진입점. Function URL 로 호출한다 — API Gateway는 쓰지 않는다 (D14).
//
// Function URL과 API Gateway HTTP API v2 는 같은 이벤트/응답 형태를 쓴다.
// src/api.js 의 route() 는 그 형태를 몰라도 되게 이미 method/path/query/body로 분리돼 있어서,
// 이 파일과 scripts/dev-server.mjs 가 같은 라우팅 로직을 공유한다.
//
// 배포 방법: scripts/build-lambda.mjs 로 dist/lambda/ 에 이 파일 + src/*.js 를 그대로 복사해
// index.mjs 로 이름만 바꾸고(zip 안에서 상대경로 ./src/... 가 그대로 성립하도록), zip 뒤 업로드한다.
// 별도 npm 의존성이 없다 — googleapis 대신 fetch만 쓰기로 한 D13 덕분에 node_modules가 필요 없다.

import { authFromEnv, createAuth, createTasksClient, createCalendarClient, GoogleApiError } from './src/google.js';
import { createApi, route } from './src/api.js';
import { checkBearer } from './src/auth.js';
import { clearSessionCookie, getSession, getStateCookies, oauthCallback, oauthStart } from './src/oauth.js';

const apiByUser = new Map();

function getApi(session) {
  const key = session?.sub || 'legacy';
  if (!apiByUser.has(key)) {
    const auth = session
      ? createAuth({
          clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
          clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
          refreshToken: session.refreshToken
        })
      : authFromEnv(process.env);
    apiByUser.set(key, createApi({
      tasks: createTasksClient(auth),
      calendar: createCalendarClient(auth),
      settings: {
        defaultTime: process.env.DEFAULT_DUE_TIME || '09:00',
        timeZone: process.env.DEFAULT_TZ || 'Asia/Seoul',
        pwaBaseUrl: process.env.PWA_BASE_URL || 'https://assist.nz.pe.kr'
      }
    }));
  }
  return apiByUser.get(key);
}

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  },
  body: JSON.stringify(body)
});

const authError = () => json(401, { error: '로그인이 필요합니다.' });

function withCors(response) {
  // Lambda Function URL owns CORS headers; adding them here duplicates the response header.
  return response;
}

function lambdaResponse(response) {
  const { cookies, ...rest } = response;
  return cookies ? { ...rest, cookies } : rest;
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try { return JSON.parse(raw); } catch { return {}; }
}

export const handler = async event => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';

  if (method === 'OPTIONS') return withCors({ statusCode: 204, headers: {}, body: '' });

  const query = Object.fromEntries(new URLSearchParams(event.rawQueryString ?? ''));
  try {
    if (method === 'GET' && path === '/auth/google/start') {
      if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET || !process.env.OAUTH_SESSION_SECRET) {
        return withCors(json(500, { error: 'Google OAuth 환경변수가 설정되지 않았습니다.' }));
      }
      return lambdaResponse(oauthStart(process.env));
    }
    if (method === 'GET' && path === '/auth/google/callback') {
      return lambdaResponse(await oauthCallback({ env: process.env, query, cookies: getStateCookies(event.headers, event.cookies) }));
    }
    if (method === 'POST' && path === '/auth/logout') {
      return lambdaResponse(withCors({ statusCode: 200, headers: { 'content-type': 'application/json' }, cookies: [clearSessionCookie()], body: JSON.stringify({ ok: true }) }));
    }
    if (method === 'GET' && path === '/auth/me') {
      const session = getSession(event.headers, process.env);
      return withCors(session ? json(200, { authenticated: true, user: { email: session.email, name: session.name } }) : json(200, { authenticated: false }));
    }
  } catch (e) {
    console.error(`${method} ${path} → 500: ${e.message}`);
    return withCors(json(500, { error: 'Google 로그인 처리에 실패했습니다.' }));
  }

  const session = getSession(event.headers, process.env);
  const legacyAuthorized = Boolean(process.env.API_TOKEN) && checkBearer(event.headers, process.env.API_TOKEN);
  if (!session && !legacyAuthorized) return withCors(authError());

  try {
    const result = await route(getApi(session), method, path, query, parseBody(event));
    return withCors(json(200, result));
  } catch (e) {
    const status = e.status ?? (e instanceof GoogleApiError ? e.status : 500);
    console.error(`${method} ${path} → ${status}: ${e.message}`);
    return withCors(json(status, { error: e.message, reason: e.reason }));
  }
};
