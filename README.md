# nzassist

Google Calendar를 백엔드로 쓰는 개인용 할일 매니저입니다.
1차 목표는 Todoist 유료 계정을 끊고도 알림을 놓치지 않는 것이고,
장기적으로는 todo / calendar / Obsidian note를 하나로 묶는 것입니다.

작업 목록과 결정 근거는 [TODO.md](TODO.md)에 있습니다.

## 왜 Google Tasks가 아니라 Calendar인가

Tasks 백엔드는 시각을 정상적으로 저장합니다. 문제는 **공개 Tasks API v1이 그걸 노출하지 않는다**는 것입니다.

> It isn't possible to read or write the time that a task is scheduled for using the API.
> — [Tasks API 레퍼런스](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks)

deadline·반복·알림 필드도 API에는 없고, 릴리스 노트는 2024-07 이후 멈춰 있습니다.
"19:00에 울리는 항목"을 안정적인 공개 API로 **만들어야** 하는 이상, 선택지는 Calendar Events뿐입니다.

| | Tasks API | Calendar Events API |
|---|---|---|
| 시각 | ❌ 날짜만 | `start.dateTime` ✅ |
| 소요시간 | ❌ | `start`/`end` ✅ |
| 알림 | ❌ | `reminders.overrides` 최대 5개 ✅ |
| 반복 | ❌ | RFC5545 RRULE ✅ |
| 메타데이터 | ❌ | `extendedProperties` 300개·32KB, 검색 가능 ✅ |
| 증분 동기화 | `updatedMin` | `syncToken` ✅ |
| 완료 체크 | ✅ | ❌ (→ PWA와 완료 링크로 보완) |

## 구조

```text
PWA (Cloudflare Pages)
  └─ 한 줄 입력 → 규칙 기반 파서 → 제안 카드 확인 → 저장
        │
        ▼
AWS API Gateway + Lambda
  ├─ Google Calendar API (이벤트 CRUD, 알림, RRULE)
  └─ DynamoDB (사용자 설정 · OAuth refresh token · syncToken 커서)
        ▲
        │
EventBridge (주기 실행)
  └─ normalizer: @context 정리, 완료 기준 반복의 다음 회차 생성
```

## Calendar deep link

시각이 있는 task의 동반 Calendar 이벤트에는 다음 PWA 링크가 들어갑니다.

```text
https://assist.nz.pe.kr/t/{taskId}?list={listId}
```

Calendar 알림을 누르면 PWA가 전체 task 중 해당 항목을 찾아 `전체` 보기에서 단건을 강조하고 화면 중앙으로 이동시킵니다. 완료·미루기·편집은 PWA에서 처리합니다. Calendar 이벤트를 링크 클릭만으로 자동 완료시키지 않는 이유는 링크 미리보기나 crawler가 GET URL을 호출할 수 있기 때문입니다.

Cloudflare Pages의 `public/_redirects`가 `/t/...` 직접 진입을 `index.html`로 넘깁니다. task id가 존재하지 않거나 list id가 맞지 않으면 일반 목록으로 열립니다.

## 표기 규칙

```text
<사람이 읽는 제목> [@컨텍스트] [#태그 ...]
```

- `@컨텍스트` — 저장 시 title에서 제거되고 `nz_context`가 됩니다. 2개 이상이면 첫 번째만 쓰고 나머지는 `#태그`로 내려갑니다.
- `#태그` — native Calendar 앱에서 보이도록 title에 그대로 남습니다.
- 설정값(`nz_rep`, `nz_priority` 등)은 title이 아니라 `extendedProperties`에 들어갑니다.

입력 예시:

```text
노트북 반품하기 19:00              → 오늘 19:00
@미혜 불꽃놀이 9/5                 → 미혜 컨텍스트, 내년 9/5 09:00 (오늘이 9/6이므로)
가습기 청소 every! 2 weeks         → 완료일 기준 2주 뒤 반복
정수기필터 every 18 months at 23:59 → 고정 스케줄 반복 (RRULE)
```

`every`와 `every!`의 차이가 핵심입니다. `every`는 원래 스케줄대로 돌고,
`every!`는 **완료한 날로부터** 다시 셉니다. 3개월마다 갈아야 하는 정수기 필터를
한 달 늦게 갈았다면 다음은 두 달 뒤가 아니라 **완료일로부터 3개월 뒤**여야 합니다.

## 개발

```bash
npm test          # 파서 회귀 테스트
```

정적 PWA라 빌드 단계가 없습니다. `index.html`을 `localhost`로 서빙하면 됩니다
(Service Worker와 Notification은 `localhost` 또는 HTTPS에서만 동작합니다).

## 설정

`.env.example`을 `.env`로 복사해 채웁니다. `.env`는 커밋되지 않습니다.
브라우저 쪽 설정은 `config.example.js` → `config.js`입니다.

개인 Gmail 계정의 Calendar는 서비스 계정으로 접근할 수 없어 OAuth refresh token이 필요합니다.

### Google OAuth 게시 상태

운영 Lambda는 웹 OAuth 로그인으로 발급한 세션 쿠키를 우선 사용합니다. Google 로그인 후 사용자별 refresh token이 암호화된 HttpOnly 세션 쿠키에 들어가며, 해당 사용자의 Tasks와 Calendar를 호출합니다. 기존 `.env`의 `GOOGLE_OAUTH_REFRESH_TOKEN`과 `API_TOKEN`은 마이그레이션·롤백을 위한 legacy fallback으로만 남아 있습니다.

테스트 계정을 실제 계정으로 바꾸려면 우선 로컬에서 다음처럼 새 계정의 refresh token을 발급할 수 있습니다.

```text
node --env-file=.env scripts/google-auth.mjs
```

운영 로그인은 다음 주소에서 시작합니다.

```text
https://assist.nz.pe.kr/auth/google/start
```

로그인 흐름은 다음과 같습니다.

```text
PWA → Lambda /auth/google/start
  → Google consent
  → Lambda /auth/google/callback
  → 암호화된 HttpOnly 세션 쿠키 발급
  → 사용자별 Tasks / Calendar 호출
```

1. Google Cloud Console의 OAuth consent screen에서 앱 정보를 입력합니다.
2. User type을 실제 대상에 맞게 `External`로 설정하고 테스트 사용자 제한을 확인합니다.
3. 앱을 `Testing`에서 `In production`으로 게시합니다.
4. `tasks`와 `calendar` scope가 민감한 범주로 검토되는지 확인하고, Google이 검증을 요구하면 앱 홈페이지·개인정보처리방침·도메인 소유권을 등록합니다.
5. 운영 로그인에는 데스크톱용 클라이언트가 아니라 `Web application` OAuth client를 사용합니다. 현재 callback은 Lambda Function URL입니다.
6. 현재 구현은 callback에서 받은 사용자별 refresh token을 AES-256-GCM으로 암호화해 HttpOnly 세션 쿠키에 보관합니다. 세션 저장소가 필요해지는 규모에서는 DynamoDB 또는 Secrets Manager 방식으로 교체합니다.
7. PWA는 credentialed request로 Lambda에 세션 쿠키를 전달합니다.

현재 `scripts/google-auth.mjs`는 로컬 PKCE + loopback callback으로 한 계정의 refresh token을 받는 도구입니다. 이를 그대로 Pages 로그인에 사용하면 안 됩니다. 운영용 로그인은 다음 흐름이 되어야 합니다.

```text
PWA → Lambda /auth/google/start
  → Google consent
  → Lambda /auth/google/callback
  → 사용자별 refresh token 저장
  → PWA session cookie 발급
```

Google Cloud Console에서 앱을 `In production`으로 게시하는 것은 테스트 사용자 제한을 없애는 설정입니다. 웹 callback·세션·사용자별 토큰 처리는 이미 Lambda에 구현되어 있으며, Google OAuth Web application client에 callback URI가 정확히 등록되어 있어야 합니다.
