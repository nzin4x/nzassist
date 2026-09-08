// 고정 bearer 토큰 확인 (D13). dev-server와 Lambda가 이 하나만 공유한다.
//
// 개인용 단일 사용자 앱이라 OAuth를 PWA까지 끌고 갈 이유가 없다. 토큰 자체는
// 클라이언트 JS에 실려 나가는 이상 완전한 비밀은 아니지만, 엔드포인트를 공개
// 스캔·크롤링으로부터 가리는 최소한의 장치로는 충분하다.

export function checkBearer(headers, expected) {
  if (!expected) return true; // 토큰을 설정하지 않았으면 열어둔다 (로컬 개발 기본값)
  const raw = headers?.authorization ?? headers?.Authorization ?? '';
  return raw.replace(/^Bearer\s+/i, '').trim() === expected;
}
