// AWS Lambda 진입점. Function URL 로 호출한다 — API Gateway는 쓰지 않는다 (D14).
//
// Function URL과 API Gateway HTTP API v2 는 같은 이벤트/응답 형태를 쓴다.
// src/api.js 의 route() 는 그 형태를 몰라도 되게 이미 method/path/query/body로 분리돼 있어서,
// 이 파일과 scripts/dev-server.mjs 가 같은 라우팅 로직을 공유한다.
//
// 배포 방법: scripts/build-lambda.mjs 로 dist/lambda/ 에 이 파일 + src/*.js 를 그대로 복사해
// index.mjs 로 이름만 바꾸고(zip 안에서 상대경로 ./src/... 가 그대로 성립하도록), zip 뒤 업로드한다.
// 별도 npm 의존성이 없다 — googleapis 대신 fetch만 쓰기로 한 D13 덕분에 node_modules가 필요 없다.

import { authFromEnv, createTasksClient, createCalendarClient, GoogleApiError } from './src/google.js';
import { createApi, route } from './src/api.js';
import { checkBearer } from './src/auth.js';

let api; // 워밈 스타트 사이에 재사용

function getApi() {
  if (!api) {
    const auth = authFromEnv(process.env);
    api = createApi({
      tasks: createTasksClient(auth),
      calendar: createCalendarClient(auth),
      settings: {
        defaultTime: process.env.DEFAULT_DUE_TIME || '09:00',
        timeZone: process.env.DEFAULT_TZ || 'Asia/Seoul'
      }
    });
  }
  return api;
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body)
});

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try { return JSON.parse(raw); } catch { return {}; }
}

export const handler = async event => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';

  if (method === 'OPTIONS') return { statusCode: 204, headers: {}, body: '' }; // Function URL 네이티브 CORS가 실제 처리

  if (!checkBearer(event.headers, process.env.API_TOKEN)) {
    return json(401, { error: 'unauthorized' });
  }

  const query = Object.fromEntries(new URLSearchParams(event.rawQueryString ?? ''));

  try {
    const result = await route(getApi(), method, path, query, parseBody(event));
    return json(200, result);
  } catch (e) {
    const status = e.status ?? (e instanceof GoogleApiError ? e.status : 500);
    console.error(`${method} ${path} → ${status}: ${e.message}`);
    return json(status, { error: e.message, reason: e.reason });
  }
};
