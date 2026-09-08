// Google OAuth refresh token 1회 획득 스크립트.
//
//   node --env-file=.env scripts/google-auth.mjs
//
// 개인 Gmail 계정의 Calendar는 서비스 계정으로 접근할 수 없어서
// 사용자 동의를 거친 refresh token이 필요하다. 이 토큰을 .env에 넣으면
// 이후 Lambda가 access token을 알아서 갱신한다.
//
// Google Cloud에서 "데스크톱 앱" 유형 OAuth 클라이언트를 만들고
// 승인된 리디렉션 URI에 http://127.0.0.1:53682/callback 를 넣어둬야 한다.

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPE = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar'
].join(' ');

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('.env 에 GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET 를 먼저 채우세요.');
  console.error('실행: node --env-file=.env scripts/google-auth.mjs');
  process.exit(1);
}

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(16));

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent', // refresh_token을 반드시 받기 위해
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state
});

const reply = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:3rem">${body}</body>`);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/callback') return reply(res, 404, 'not found');

  const err = url.searchParams.get('error');
  if (err) {
    reply(res, 400, `<h1>인증 실패</h1><p>${err}</p>`);
    console.error('인증 거부:', err);
    server.close();
    process.exitCode = 1;
    return;
  }

  if (url.searchParams.get('state') !== state) {
    reply(res, 400, '<h1>state 불일치</h1>');
    console.error('state 불일치 — 요청을 폐기했습니다.');
    server.close();
    process.exitCode = 1;
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code'),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
      code_verifier: verifier
    })
  });

  const token = await tokenRes.json();

  if (!tokenRes.ok || !token.refresh_token) {
    reply(res, 500, '<h1>토큰 교환 실패</h1><p>터미널을 확인하세요.</p>');
    console.error('토큰 교환 실패:', JSON.stringify(token, null, 2));
    if (tokenRes.ok && !token.refresh_token) {
      console.error('\nrefresh_token이 없습니다. 이미 승인된 앱이면 Google이 생략합니다.');
      console.error('https://myaccount.google.com/permissions 에서 앱 권한을 지우고 다시 실행하세요.');
    }
    server.close();
    process.exitCode = 1;
    return;
  }

  reply(res, 200, '<h1>완료</h1><p>터미널로 돌아가세요. 이 창은 닫아도 됩니다.</p>');
  console.log('\n성공. 아래 값을 .env 의 GOOGLE_OAUTH_REFRESH_TOKEN 에 넣으세요:\n');
  console.log(token.refresh_token);
  console.log('\n(이 값은 비밀입니다. 커밋하지 마세요.)');
  server.close();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('브라우저에서 Google 계정 동의를 진행하세요.');
  console.log(`열리지 않으면 아래 주소를 직접 붙여넣으세요:\n\n${authUrl}\n`);
  // cmd의 `start`를 쓰면 URL 안의 &가 명령 구분자로 먹힌다. rundll32는 URL을 통째로 받는다.
  const [cmd, cmdArgs] = process.platform === 'win32'
    ? ['rundll32', ['url.dll,FileProtocolHandler', authUrl]]
    : [process.platform === 'darwin' ? 'open' : 'xdg-open', [authUrl]];
  spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).unref();
});
