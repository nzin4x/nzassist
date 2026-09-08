// 로컬에서 배포 환경을 흉내내고 싶을 때만 config.js 로 복사해서 쓴다.
// config.js는 gitignore 대상이다 — 보통은 이 파일 대신 `node scripts/build-config.mjs`가
// 배포 시점(Cloudflare Pages 빌드)에 환경변수로부터 자동 생성한다.
window.NZASSIST_CONFIG = {
  // Lambda Function URL. 비워두면 같은 origin의 /api 를 호출한다 (로컬 dev-server 기본값).
  apiBaseUrl: '',
  // scripts/deploy-lambda.ps1 실행 시 발급/출력되는 고정 토큰
  apiToken: '',
  defaultTime: '09:00',
  timeZone: 'Asia/Seoul'
};
