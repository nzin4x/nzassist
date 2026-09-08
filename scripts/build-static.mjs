// public/ 을 배포 가능한 상태로 만든다. Cloudflare Pages 빌드 명령으로 등록한다.
//
//   Build command    : node scripts/build-static.mjs
//   Build output dir : public
//   환경변수(Pages 프로젝트 설정) : API_BASE_URL, API_TOKEN
//
// 하는 일 두 가지:
//   1. public/config.js 생성 — 토큰을 커밋하지 않으면서 배포 시점 값을 정적 사이트에 심는다.
//   2. src/query.js 를 public/ 로 복사 — 프론트가 쓰는 JQL 파서는 src/ 의 것과 같은 코드다.
//      (로컬 dev-server는 이 복사 없이 src/query.js 를 직접 서빙한다 — scripts/dev-server.mjs 참고)

import { writeFile, copyFile } from 'node:fs/promises';

const cfg = {
  // Pages Functions proxy /api and /auth on the app's own origin.
  apiBaseUrl: process.env.API_BASE_URL ?? '',
  // Production uses the HttpOnly Google session cookie; never ship the legacy token to browsers.
  apiToken: process.env.PUBLIC_API_TOKEN ?? '',
  defaultTime: process.env.DEFAULT_DUE_TIME ?? '09:00',
  timeZone: process.env.DEFAULT_TZ ?? 'Asia/Seoul'
};

await writeFile('public/config.js', `window.NZASSIST_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`, 'utf8');
console.log(`public/config.js 생성 (apiBaseUrl=${cfg.apiBaseUrl || '(비어있음 — 같은 origin으로 호출)'})`);

await copyFile('src/query.js', 'public/query.js');
console.log('public/query.js 복사 완료');
