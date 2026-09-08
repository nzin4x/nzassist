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
