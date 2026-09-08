// 로컬 개발 서버. 정적 PWA를 서빙하고 /api/* 를 Google Tasks에 연결한다.
//
//   node --env-file=.env scripts/dev-server.mjs
//   → http://localhost:5173
//
// Lambda와 같은 src/api.js 를 쓰므로, 여기서 동작하면 배포해도 동작한다.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { authFromEnv, createTasksClient, createCalendarClient, GoogleApiError } from '../src/google.js';
import { createApi, route } from '../src/api.js';
import { checkBearer } from '../src/auth.js';

const PORT = Number(process.env.DEV_PORT ?? 5173);
// Cloudflare Pages는 public/ 을 빌드 출력 디렉터리로 잡는다. 정적 파일 루트를 거기에 맞춘다.
const ROOT = join(process.cwd(), 'public');

const auth = authFromEnv();
const api = createApi({
  tasks: createTasksClient(auth),
  // 시각이 붙은 할 일은 동반 이벤트가 알람을 울린다 (D6)
  calendar: createCalendarClient(auth),
  settings: {
    defaultTime: process.env.DEFAULT_DUE_TIME || '09:00',
    timeZone: process.env.DEFAULT_TZ || 'Asia/Seoul'
  }
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readBody = req => new Promise(resolve => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
  });
});

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    const started = Date.now();
    // API_TOKEN을 .env에 설정한 경우에만 검사한다 — Lambda와 같은 로직(src/auth.js)을 공유해
    // 로컬에서 통과하면 배포 후에도 통과한다.
    if (!checkBearer(req.headers, process.env.API_TOKEN)) return json(res, 401, { error: 'unauthorized' });
    try {
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const result = await route(api, req.method, url.pathname, Object.fromEntries(url.searchParams), body);
      console.log(`${req.method} ${url.pathname} → 200 (${Date.now() - started}ms)`);
      return json(res, 200, result);
    } catch (e) {
      const status = e.status ?? (e instanceof GoogleApiError ? e.status : 500);
      console.error(`${req.method} ${url.pathname} → ${status}: ${e.message}`);
      return json(res, status, { error: e.message, reason: e.reason });
    }
  }

  // query.js 는 src/ 의 것을 그대로 서빙한다 (배포 때는 build-static.mjs 가 복사해 넣는다).
  // 매번 복사할 필요 없이 로컬에서는 항상 최신 소스를 쓰게 한다.
  if (url.pathname === '/query.js') {
    try {
      res.writeHead(200, { 'content-type': MIME['.js'] });
      res.end(await readFile(join(process.cwd(), 'src', 'query.js')));
    } catch {
      res.writeHead(404); res.end('not found');
    }
    return;
  }

  // 정적 파일. 경로 탈출을 막는다.
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) return json(res, 403, { error: 'forbidden' });

  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}).listen(PORT, () => {
  console.log(`nzassist dev  →  http://localhost:${PORT}`);
  console.log('Google Tasks 실계정에 연결됩니다. 만들고 지우는 것이 실제로 반영됩니다.');
});
