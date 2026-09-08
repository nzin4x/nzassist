# nzassist — TODO

> **한 줄 목표:** Todoist 유료 계정을 끊고, Google Tasks를 할일의 원본으로 쓰면서
> 정시 알림까지 받는 나만의 할일 매니저를 만든다.
> 장기적으로 todo / calendar / Obsidian note를 통합한다.

- 저장소: <https://github.com/nzin4x/nzassist>
- 배포: GitHub push → Cloudflare Pages 자동 sync
- 백엔드: AWS API Gateway + Lambda (+ DynamoDB 설정 저장, EventBridge 정리 작업)

---

## 0. 능력 검증표 (실측, 2026-09-07)

문서를 믿지 않고 실제 계정에 찔러본 결과다.
재현: `node --env-file=.env scripts/capability-matrix.mjs --write`
([`scripts/capability-matrix.mjs`](scripts/capability-matrix.mjs) · 결과 `data/capability-matrix.json`)

| 기능 | Tasks | Calendar | 비고 |
|---|:--:|:--:|---|
| **완료 상태 + 완료시각** | **O** | X | Event에는 완료 개념 자체가 없다 |
| **날짜 없는 항목(someday)** | **O** | X | Event는 start가 필수 (`400 Missing end time`) |
| **하위 작업(subtask)** | **O** | X | `parent`는 body가 아니라 쿼리 파라미터 |
| **메타데이터 저장** | **O** notes | **O** extProps | notes 8192자, 여러 줄 보존 |
| 리스트/캘린더 간 이동 | O | O | Tasks도 `destinationTasklist`로 됨 |
| 증분 동기화 | O `updatedMin` | O `syncToken` | Tasks에 syncToken은 없음 |
| **시각(time of day)** | **X** | **O** | Tasks는 `19:00` → `00:00:00` 으로 잘림 |
| **소요시간** | X | **O** | Task에 start/end 없음 |
| **알림 설정** | X | **O** | Tasks는 필드가 조용히 버려짐 |
| **반복 규칙(RRULE)** | X | **O** | Tasks는 필드가 조용히 버려짐 |
| 메타데이터로 검색 | X | **O** | Tasks는 전량 조회 후 클라이언트 필터 |

**읽는 법:** 위 4줄(할일의 본질)은 Tasks만 되고, 아래 4줄(일정의 본질)은 Calendar만 된다.
어느 한쪽으로 몰 수 없다는 게 실측으로 확정됐다.

---

## 1. 확정된 결정 (Decisions)

- [x] **D1. 앱 이름은 `nzassist`**

- [x] **D2. 할일의 원본은 Google Tasks. Calendar 이벤트는 알람 장치일 뿐이다.**
    - 원하는 건 **todo**다. 이벤트는 todo의 강화버전이 아니다 —
      **할일은 완료 상태를 갖고 끝날 때까지 남지만, 이벤트는 시간이 지나면 흘러가 버린다.**
      안 한 일이 사라지는 건 todo가 아니다. `/r/tasks` 뷰·체크박스·밀린 항목이 전부 Tasks 몫이다.
    - Tasks API가 시각을 못 쓰는 것은 실측으로 확정됐다 (insert·patch 모두 `00:00:00`으로 절단).
      Tasks 백엔드 자체는 시각을 저장한다 (내부 Sync API 페이로드에서 확인). 공개 API가 낡았을 뿐이고,
      내부 엔드포인트는 SAPISIDHASH 세션 인증이라 서버에서 못 쓴다.
    - 따라서 **정시 알림이 필요한 항목에만** Calendar 이벤트를 동반 생성해 알람을 울린다.
      이벤트는 데이터의 주인이 아니라 알람용 부속물이다.
    - *한때 Calendar를 원본으로 삼는 안을 검토했다가 되돌렸다. 완료·someday·overdue가 전부 깨진다.*

- [x] **D3. `@context` = Google Tasks의 list**
    - `@회사>CMP` → `회사>cmp` 리스트. (계정에 이미 이 이름의 리스트가 있다)
    - PWA에서 `@` 입력 시 기존 리스트 suggestion. 무시하고 새 이름을 쓰면 새 리스트 생성 의도.
    - `@`가 2개 이상이면 첫 번째만 쓰고 나머지는 `#tag`로 강등.
    - 리스트 간 이동은 `move`에 `destinationTasklist`로 가능하다 (실측 확인).

- [x] **D4. Todoist 라벨은 모두 `#tag`로 변환** (`@청소 @휴일` → `#청소 #휴일`).
      리스트는 Todoist project 이름에서 가져온다.

- [x] **D5. 메타데이터는 `task.notes` 하단 블록에 둔다.**
    - Tasks에는 `extendedProperties`가 없다. 대신 `notes`가 8192자에 여러 줄을 그대로 보존한다(실측).
    - title에는 **사람이 읽는 문장 + `#tag`** 만 남긴다 (native Tasks 앱에서 눈으로 보고 편집).
    - 형식:
      ```text
      (사용자가 쓴 메모)

      ---nzassist---
      rep=3mo
      rep_mode=after
      context=집안일
      at=19:00
      gcal=<이벤트 id>
      src=todoist
      src_id=6X4rfFVPjhLf0PjW
      ```
    - **`at=19:00` 이 시각의 원본이다.** Tasks의 `due`는 날짜만 담으므로 시각은 여기 산다.
    - 검색: Tasks는 질의 파라미터가 없어 전량 조회 후 클라이언트에서 거른다.
      task가 202건 수준이라 문제되지 않는다.

- [x] **D6. 정시 알림("Add time")은 동반 Calendar 이벤트가 담당한다.**
    - **결정적 실측 (2026-09-07):** Google Tasks UI에도 Add time이 있고 시작~종료(`22:30–23:00`)까지
      잡히지만, **저장한 뒤 API로 읽어도 `due`는 여전히 `00:00:00`이고 새 필드도 생기지 않는다.**
      UI가 저장한 시각은 API 표면에 아예 존재하지 않는다. 읽기도 쓰기도 불가.
    - 그래서 nzassist가 직접 구현한다: 시각은 notes의 `at=`, 알람은 동반 이벤트.
    - `at=` 이 있는 task에만 이벤트를 만든다. 없으면 Tasks 기본 동작에 맡긴다.
    - 이벤트 `reminders.overrides` — popup/email, 0~40320분, 최대 5개 (실측 확인).
    - 양방향 연결: task.notes의 `gcal=<eventId>` ↔ event의 `extendedProperties.private.nz_task=<taskId>`
    - task가 완료/삭제되면 동반 이벤트도 정리한다.

- [x] **D7. 반복은 nzassist가 직접 관리한다.**
    - Tasks는 `recurrence` 필드를 조용히 버린다(실측). RRULE을 맡길 수 없다.
    - **고정 스케줄** (`every 1 week`): 완료 시 다음 due = 이전 due + 간격
    - **완료 기준** (`every! 3 month`): 완료 시 다음 due = **완료일 + 간격**
    - 동반 이벤트가 있으면 RRULE로 만들어 알람만 Google에 위임할 수 있다 (알람은 배치가 죽어도 온다).
    - *Calendar를 원본으로 삼던 시절의 D7(반복 담당 분리)은 폐기.*

- [x] **D8. 완료는 native Tasks에서 그대로 하면 된다.**
    - Tasks 알림에는 **"Mark complete" 액션이 있다** (실측 확인). Calendar 알림에는 없다.
      이게 Tasks를 원본으로 삼는 결정적 이유 중 하나다.
    - `status=completed` 로 바꾸면 `completed` 타임스탬프가 남는다(실측) →
      **`every!` 의 "완료일"을 여기서 그대로 읽을 수 있다.** 별도 기록이 필요 없다.
    - normalizer가 주기적으로 최근 완료를 훑어 다음 회차를 만든다.

- [x] **D9. 동기화는 `updatedMin` 증분 방식** (Tasks에 syncToken은 없다). 커서는 DynamoDB에.

- [x] **D11. 동반 이벤트는 단방향 투영이다. 양방향 싱크는 하지 않는다.**
    - task와 이벤트를 양쪽 다 수정 가능하게 두면 충돌 해결이 필요해지고,
      "캘린더에서 일정을 옮겼는데 task는 그대로"인 상태가 반드시 생긴다.
    - **task가 단일 진실.** 이벤트를 직접 옮기면 normalizer가 task 기준으로 되돌린다.
      예측 가능한 대신 이벤트는 사실상 읽기 전용이다.
    - 미루기·변경·삭제는 전부 task 쪽에서 한다. PWA와 native Tasks 앱이 그 경로다.

- [x] **D12. 관리 마커는 notes의 `---nzassist---` 블록 자체다.**
    - 제목에 `#nzassist` 를 붙이지 않는다 — 202건 전부에 붙으면 노이즈가 크다.
    - 블록이 있으면 nzassist 관리 항목이고, native 앱에서 열면 눈으로도 보인다.
    - `batch=<id>` 를 함께 넣어 **특정 이관분만 골라 되돌릴 수 있다.**
    - 동반 이벤트는 `nz_app=nzassist` 로 검색까지 된다.
    - 안전장치: [`scripts/purge.mjs`](scripts/purge.mjs) — 기본이 dry-run,
      `--confirm` 없이는 지우지 않고, **native task는 절대 건드리지 않는다.**

- [x] **D13. 도구 선택**
    - Lambda 배포: zip + AWS CLI 스크립트 (SAM/CDK 미도입)
    - API 인증: 고정 bearer 토큰 (`.env` + PWA localStorage)
    - 런타임: Node 22 (Lambda `nodejs22.x`) / 테스트: `node --test`
    - 타임존: Asia/Seoul 고정 +09:00 (DST 없음). 바뀌면 `src/civil.js`를 Intl 기반으로 교체

---

## 2. Phase 0 — 기반 세팅

- [x] `.gitignore` / `.env` / `.env.example`
- [x] `Daymark` 잔재 정리 (manifest · index.html · sw.js · app.js · config · README)
- [x] 루트 `package.json` + `node --test`
- [x] Node.js 설치 (v24.19.0)
- [x] `git init` + 스테이징 (`.env` 무시 확인)
- [ ] **보안:** 채팅으로 노출된 자격증명 정리
    - [ ] Google 세션 쿠키 노출 → 모든 기기에서 로그아웃 + 비밀번호 변경
    - [ ] Todoist API token 재발급 (마이그레이션 완료 후)
    - [ ] Cloudflare API token 재발급
- [ ] 아이콘 제작 (`manifest.icons` 가 비어 있음)
- [ ] 로컬 디렉터리를 저장소 이름(`nzassist`)과 맞출지 결정
- [ ] remote 연결 → 첫 push
- [ ] Cloudflare Pages 프로젝트 생성 후 연결

---

## 3. Phase 1 — 인증

- [x] Google Cloud 프로젝트 + **Calendar API / Tasks API** 활성화
- [x] OAuth 클라이언트 (데스크톱 앱), 리디렉션 `http://127.0.0.1:53682/callback`
- [x] scope: `tasks` + `calendar`
- [x] [`scripts/google-auth.mjs`](scripts/google-auth.mjs) 로 refresh token 획득 (PKCE)
- [x] [`scripts/capability-matrix.mjs`](scripts/capability-matrix.mjs) 로 두 API 능력 실측
- [ ] **알려진 제약: 게시 상태가 Testing이라 refresh token이 7일 후 만료된다.**
      상시 운영 전에 `In production` 전환 필요
- [ ] Lambda에서 쓸 refresh token 보관처 결정 (DynamoDB vs Secrets Manager)

---

## 4. Phase 2 — Todoist 추출 (완료)

- [x] project 24 · task 202 · label 120 · 반복 57 (그 중 `every!` 28) 덤프
- [x] **`due.date`에 이미 시각까지 해결돼 있다** (`2025-09-23T07:00:00`)
      → 마이그레이션은 자연어 재파싱 없이 **반복 규칙만** `due.string`에서 뽑으면 된다
- [x] 파서 커버리지 **100%** (반복 문장 53종 전부)
- [ ] CSV export 1부 대조용 보관
- [ ] 확인 필요: 제목에 `@` 가 든 task 1건 (`@NiceGuyHealthyBody🏋️‍♀️ 🍎 과일야채 🥬`)
- [ ] 확인 필요: 제목에 `#반복` 이 든 task 1건

---

## 5. Phase 3 — 파서 (완료)

> [`src/parse.js`](src/parse.js) · [`src/civil.js`](src/civil.js) · [`test/parse.test.js`](test/parse.test.js)

- [x] 시각 `19:00` `7시30분` `오후 7시` `7am` `7 pm` `at 23:59`
- [x] 상대 `in 5 min` `in 3 days 09:00` `내일` `모레` `2주후에`
- [x] 날짜 `9/5` `10 oct` `2026-09-05` `9월 5일` · 지난 날짜는 내년으로
- [x] 반복 `every N unit` `every! N unit` `every saturday` `every 10 oct` `every 28th dec`
      `every 10th` `every 3-1` `every! workday` `ev day`
- [x] 한국어 반복 `매년` `매월 25일` `토요일 마다` `매! 30일` `7월25일마다` `매마지막날`
- [x] 기본 시각 09:00 자동 적용
- [x] `@` 2개 이상이면 첫 번째만 컨텍스트
- [ ] 미구현: `다음주 화요일`

---

## 6. Phase 4 — Tasks 매핑 계층 (완료)

> 기존 [`src/event.js`](src/event.js)(Calendar 이벤트 매핑)는 D2 번복으로 **동반 이벤트 생성용으로 격하**된다.
> 새로 Tasks 매핑을 만든다.

- [x] [`src/task.js`](src/task.js) — 파서 결과 ↔ Tasks 리소스
    - [x] `toTask` / `readNotes` / `writeNotes` / `patchMeta` / `isManaged`
    - [x] 사용자 메모와 메타 블록 분리 — 편집해도 서로 유실되지 않는다
    - [x] nzassist가 모르는 메타 필드도 그대로 통과 (전방 호환)
    - [x] notes 8192자 초과 시 메타를 지키고 사용자 메모를 자름
- [ ] `src/companion.js` — `at=` 있는 task ↔ 동반 Calendar 이벤트
    - [ ] 생성 / 갱신 / 삭제
    - [ ] 양방향 id 연결 (`gcal=` ↔ `nz_task=`)
- [x] [`src/repeat.js`](src/repeat.js) — 다음 회차 계산
    - [x] 고정: 이전 due + 간격 (여러 회차 밀렸으면 오늘 이후로 따라잡음)
    - [x] 완료 기준: `task.completed` + 간격
    - [x] **검증 통과:** `every! 3 month` 1개월 지연 완료 → 2027-01-06 (완료일+3개월)
- [x] 단위 테스트 74건 전부 통과

---

## 7. Phase 5 — Todoist → Tasks 마이그레이션 (dry-run 통과)

> [`src/todoist.js`](src/todoist.js) 변환 · [`scripts/migrate.mjs`](scripts/migrate.mjs) 실행 · [`scripts/purge.mjs`](scripts/purge.mjs) 되돌리기
> `node --env-file=.env scripts/migrate.mjs` — 기본이 dry-run, `--confirm` 없이는 계정에 쓰지 않는다.


> 계정에 이미 `My Tasks` / `회사>cmp` 두 리스트가 있다.

- [x] Todoist project → Tasks list 매핑 (기존 재사용 우선, 이모지 제거 후 정규화)
- [x] 소규모 project(5건 미만)는 리스트를 만들지 않고 `context=` 메타로만 구분
- [x] dry-run 대조표 출력 → `data/migration-preview.json`
- [x] **dry-run 결과:** 202건 전부 변환 · 신규 리스트 6 · 기본 리스트 14 · 경고 1건
      시각 지정 63 · 날짜 없음(someday) 53 · 반복 57 (그 중 `every!` 29)
- [x] 멱등성: 이미 이관된 `src_id` 는 건너뛴다
- [ ] **실행 대기:** `--confirm` 으로 실제 이관
- [ ] 확인 필요: `🚗 cmp 프로젝트`(3건)가 기존 `회사>cmp` 리스트로 안 붙고 기본 리스트로 감
- [ ] `at=` 있는 항목에 동반 이벤트 생성
- [ ] 이관 검증: 개수 대조, 반복 전수 확인
- [ ] 기존 `Todoist` 캘린더(ICS 구독) 해지 — 중복 방지
- [ ] 며칠 실사용 후 **Todoist 유료 결제 해지** ← 1차 목표

---

## 8. Phase 6 — AWS 백엔드

- [ ] DynamoDB `nzassist-settings` (설정 + refresh token + updatedMin 커서)
- [ ] Lambda (기존 `backend/handler.mjs` 의 Sheets 코드 대체)
- [ ] API Gateway route
    - [ ] `GET /lists` · `GET /tasks` · `POST /tasks` · `PATCH /tasks/{id}`
    - [ ] `POST /tasks/{id}/complete` — 완료 + 다음 회차 생성 (핵심 경로)
    - [ ] `GET/PUT /settings`
- [ ] CORS를 Pages 도메인으로 제한 · bearer 토큰 검증

---

## 9. Phase 7 — normalizer (EventBridge)

- [ ] `updatedMin` 으로 최근 변경분만 조회
- [ ] 보정 1 — title에 `@xxx` 가 남아 있으면 해당 리스트로 `move`
- [ ] 보정 2 — 최근 완료된 반복 task의 다음 회차 생성 (`task.completed` 기준)
- [ ] 보정 3 — `at=` 있는 task의 동반 이벤트 생성/갱신/삭제
- [ ] 보정 4 — 기본 시각 적용
- [ ] 커서와 처리 건수 기록

---

## 10. Phase 8 — PWA (첫 화면 동작 중)

> 로컬 실행: `node --env-file=.env scripts/dev-server.mjs` → http://localhost:5173
> [`scripts/dev-server.mjs`](scripts/dev-server.mjs) 는 Lambda와 같은 [`src/api.js`](src/api.js) 를 쓴다.
> 여기서 동작하면 배포해도 동작한다.

- [x] 목록 — 리스트별 / 오늘 / 이번 주 / 밀린 항목 / 날짜 없음
- [x] 첫 화면이 비면 밀린 항목 → 전체 순으로 자동 전환
- [x] native task와 nzassist 관리 항목을 배지로 구분
- [x] 스마트 입력창 — 입력 중 파싱 결과를 실시간 미리보기
- [x] 완료 버튼 → 반복이면 다음 회차 자동 생성
- [ ] `@` 리스트 suggestion · `#` 태그 suggestion
- [ ] 편집 — notes 메타를 폼 UI로. **모르는 필드도 그대로 통과시켜 유실 방지**
- [ ] 편집 UI (현재는 생성·완료만)
- [ ] 설정 — 기본 시각, normalizer 주기, 타임존
- [ ] `sw.js` 갱신 · Pages 배포 확인

---

## 11. 백로그

- [ ] Obsidian note 연동
- [ ] 가족 공유 (Tasks는 공유가 약하다 — 캘린더 공유와 조합 검토)
- [ ] LLM 파서 (규칙 실패분만, 결과는 항상 제안 카드)
- [ ] daily brief / weekly plan
- [ ] subtask 활용 (Tasks가 지원함이 확인됨)
- [ ] short link `/t/{short_id}`

---

## 12. 열린 질문 / 리스크

- [ ] 동반 이벤트가 캘린더를 지저분하게 만들지 — 실사용 확인
- [ ] Tasks에 메타데이터 검색이 없어 전량 조회에 의존 — 건수 늘면 재검토
- [ ] Tasks 알림의 정확한 발화 조건 (날짜만 있는 task는 언제 울리는가) — 실측 필요
- [ ] refresh token 7일 만료 (Testing 상태)
- [ ] 타임존: task별 저장 vs 계정 단일

---

## 13. Add time (완료, 2026-09-07)

> [`src/companion.js`](src/companion.js) · [`test/companion.test.js`](test/companion.test.js) · PWA 시각 편집기

Google Tasks UI의 Add time은 API로 읽을 수 없으므로 nzassist가 자체 구현했다.
시각은 `notes`의 `at=`, 알람은 동반 Calendar 이벤트가 울린다.

- [x] `companionEvent()` — task → 이벤트 본문 (순수 함수)
- [x] `syncCompanion()` — 생성 / 이동 / 삭제를 task 상태에 맞춤
- [x] 소요시간 `dur=30m|1h30m` → `end - start` (자정 넘으면 23:59로 클램프)
- [x] PWA: 할 일마다 `＋ 시간` 버튼 → 날짜·시각·소요시간 편집기
- [x] 알람이 걸린 항목은 `🔔 22:30` 으로 표시
- [x] 완료하면 알람도 치운다 / 반복 다음 회차는 자기 알람을 새로 만든다
- [x] 사람이 캘린더에서 이벤트를 지웠으면 다시 만든다
- [x] 알람 생성 실패가 할 일 저장을 되돌리지 않게 분리 (`companionError` 로 알림)
- [x] **실계정 검증:** 22:30 설정 → 이벤트 생성 → 09:00+1h 변경(같은 이벤트 이동) →
      시간 없애기(이벤트 `cancelled`) 전 구간 확인
- [ ] 알림 오프셋 선택 (지금은 정시 popup 고정, Calendar는 최대 5개까지 지원)
- [ ] normalizer가 주기적으로 동반 이벤트 어긋남을 바로잡기

---

## 14. 그림자 이벤트 발견 (2026-09-07)

**시각이 붙은 Google Task는 캘린더에 `eventType: "focusTime"` 그림자 이벤트를 만든다.**
Tasks API는 시각을 숨기지만 **Calendar API로는 그대로 읽힌다.**

```json
{
  "summary": "테스트 09-10 테스트 입니다",
  "start": { "dateTime": "2026-09-20T22:30:00+09:00" },
  "end":   { "dateTime": "2026-09-20T23:00:00+09:00" },
  "eventType": "focusTime",
  "description": "Changes made to the title, description, or attachments will not be saved.
                  To make edits, please go to: https://tasks.google.com/task/g1mRTEXUrBOTzUQ2"
}
```

- [x] **읽기 확인** — Tasks UI에서 넣은 22:30 이 Calendar API에 보인다
- [x] **task와 연결 확인** — description URL의 id는 Tasks API id의 base64 디코딩값이다
      (`ZzFtUlRFWFVyQk9UelVRMg` → `g1mRTEXUrBOTzUQ2`)
- [x] **쓰기 확인** — 그림자 이벤트를 PATCH로 21:00 으로 옮겼고 유지된다
- [ ] **확인 필요: Tasks UI에도 21:00 으로 보이는가?** ← 이게 갈림길
- [ ] 그림자가 있으면 그걸 쓰고, 없으면 우리 동반 이벤트를 만드는 하이브리드
      (그래야 알람이 두 번 울리지 않는다)
- [ ] 한계: 시각이 없는 task에는 그림자가 없어 **새로 시각을 붙이는 경로로는 못 쓴다**

---

## 15. 지난 시각 처리 (완료, 2026-09-07)

> 알림은 지난 시각으로 걸 수 없다.

- [x] 날짜를 명시하지 않았는데 오늘의 그 시각이 지났으면 **다음 날**로
      (밤 10시 20분에 `20:00` → 내일 저녁 8시)
- [x] 시각도 안 줬는데 기본 시각(09:00)이 지났으면 다음 날로
- [x] 날짜를 명시하면 지난 시각이어도 **그대로 존중** (`2026-09-06 10:00`)
- [x] 연도 없는 지난 날짜는 내년으로 (오늘 9/7일 때 `9/6` → 2027-09-06)
- [x] `내일` `2주후에` `in 5 min` 처럼 날짜를 준 경우는 넘기지 않는다
- [x] 넘길 때는 경고로 알린다 ("오늘 20:00 은 지났으므로 내일로 잡았습니다")
- [ ] PWA 시각 편집기에서 과거 시각을 고르면 경고 표시 (지금은 명시 입력이라 그대로 따름)

---

## 16. 요구사항 백로그 (2026-09-07 접수)

### 16-1. 이번에 처리한 것

- [x] **버그: 9/7 22시에 `9/7 21:00` → 내년** — 연도를 안 쓴 날짜는 그 *시각*까지 비교해
      이미 지났으면 내년으로 넘긴다. 연도를 쓰면(`2026-09-07 21:00`) 그대로 존중
- [x] **레이아웃 깨짐** — 시각 편집기가 세 번째 flex 항목으로 끼어들며 제목 칸을 세로로 누르던 문제.
      `.task { flex-wrap: wrap }` + `.editor { flex-basis: 100% }`
- [x] **`#` · `@` 추천 목록** — 커서 바로 앞 토큰을 감지해 추천.
      `@`를 두 번 쓰면 **지금 입력 중인 뒤엣것**이 대상이다 (자동감지 우선).
      ↑↓ 이동 · Enter/Tab 선택 · Esc 닫기 · 없는 이름이면 "새 리스트/새 태그" 후보
- [x] **제목 클릭 = 편집** — 별도 폼 없이 입력 기반. 저장하면 서버가 다시 파싱하므로
      `@리스트` `19:00` `every! 2 weeks` 를 그대로 쓸 수 있다

### 16-2. 단축키 · 명령 팔레트

- [ ] 마우스 클릭 = 선택 / Ctrl+클릭 = 다건 선택
- [ ] `s` star · `S` 하위 task 추가 · `d` 삭제(확인) · `D` 강제 삭제 · `u` undo
- [ ] `e` / `i` 편집 모드 (2번째 줄부터는 메모, ↓ 로 메모 창 이동)
- [ ] `/` 검색창 포커스 · `f` incremental search (Esc 로 중지)
- [ ] `p` postpone (`1h` `2d` `3m` 입력, 다건 선택에도 동일)
- [ ] `c` 입력창 포커스 (포커스 상태를 테두리로 표시) · 입력 중 Esc → 목록 선택 모드
- [ ] `j` `k` 목록 이동 · `r` 새로고침 · `?` 명령 목록 팝업
- [ ] 명령 팔레트 (`delete list` 같은 예외 처리)
- [ ] **star는 Tasks API에 없다** — `starred=1` 메타로 대체할지 확인 필요

### 16-3. 검색

- [ ] 통합 검색창 (제목 검색)
- [ ] `#태그` 검색 (추천 포함) · `@컨텍스트` 검색 (AND 결합)
- [ ] JQL 풍 질의: `updated < 1d`, `created < 10d`
- [ ] `and` `or` `( )` 서브쿼리
- [ ] 입력 전 구간에 추천
- [ ] **`created` 는 Tasks API에 없다** — 메타에 `created=` 를 직접 기록해야 한다

### 16-4. 입력 · 편집 UX

- [ ] 첫 줄은 제목, Shift+Enter로 둘째 줄부터 메모 (macOS 메모 앱처럼)
- [ ] 메모는 아주 간단한 마크업 — 링크는 파란색
- [ ] 메모 live markdown 렌더
- [ ] 글자수 표시 (Tasks title 1024자 / notes 8192자 기준, 잘릴 것을 가정)
- [ ] 파싱 미리보기를 "입력상자처럼" 보이지 않게 디자인 변경
- [ ] 편집 모드에서 하위 task 추가 버튼

### 16-5. 성능

- [ ] 첫 로딩은 localStorage 캐시로 즉시 표시
- [ ] `r` 또는 신규 입력 등 이벤트가 있을 때만 API 재조회

### 16-6. 디자인

- [ ] Google Calendar 톤에 맞춘 밝고 화사하되 간결한 CSS 전면 정리

### 16-7. 아카이빙 (구현하지 않음, 기록만)

- [ ] 완료된 task를 Google Sheets `nzassist-archive` 의 `nztodo` 탭에 적재
      (Sheets API는 이미 활성화해 둠. **실제 구현은 하지 않고 할 일로만 남긴다**)

---

## 17. 단축키 · 다건 선택 · 명령 팔레트 (완료, 2026-09-07)

> [`src/api.js`](src/api.js) (`star` / `postpone` / `addSubtask` / `deleteList`) · [`test/api.test.js`](test/api.test.js) · PWA 키보드 레이어

- [x] `s` star 토글 — Tasks API에 star가 없어 `starred=1` 메타로 대신한다
- [x] `S` 하위 task 추가 (오버레이 입력창)
- [x] `d` 삭제(확인) / `D` 강제 삭제
- [x] `u` undo — 완료·star·postpone·삭제를 스택으로 되돌린다 (최근 20개)
      *삭제의 undo는 재생성이라 완전히 같은 객체가 아님을 알아둘 것*
- [x] `e` / `i` 편집 모드 — 커서가 있는 행의 제목 편집을 연다 (16-1에서 만든 제목 클릭과 동일 경로)
- [x] `/` `c` 입력창 포커스 (테두리로 포커스 표시)
- [x] `f` incremental search — 현재 필터 안에서만 실시간으로 좁힌다, Esc로 중지·복원
- [x] `p` postpone — 오버레이에 `1h 2d 3w 1mo` 입력. 시각(`at`)은 건드리지 않고 날짜만 민다
- [x] `j` `k` 목록 이동(커서) · `r` 새로고침 · `?` 도움말 팝업
- [x] 마우스 클릭 = 커서 이동 / Ctrl+클릭 = 다건 선택 토글 (별도 배경색으로 표시)
- [x] 모든 액션이 다건 선택 시 선택된 것 전체에, 없으면 커서 위치 항목에 적용된다
- [x] 입력창·편집기 등 텍스트 필드에 포커스가 있으면 전역 단축키를 끈다 (타이핑 방해 금지)
- [x] **명령 팔레트는 `:` 에 배정했다** — 원문에 `p`가 postpone과 팔레트에 중복 배정돼 있어
      vi 관례(`:`가 명령 모드)를 따라 충돌을 풀었다
- [x] 팔레트 명령: `delete list <이름>` (리스트 자체 삭제, 확인 필요) · `undo` · `refresh`
- [x] **실계정 검증 (헤드리스 브라우저, KeyboardEvent 직접 디스패치):**
      `s` → star 켜짐이 실제 Tasks에 반영 → `u` → 되돌아감 →
      `p`+`2d` → due가 밀림 → `u` → 원복 → `f` → 실시간 필터링 → `Esc` → 전체 복원
- [ ] `star`가 native Google Tasks 앱에는 보이지 않는다 (우리 메타이므로 당연) — 아이콘으로만 구분됨을 안내 문구에 남길 것
- [ ] 다건 선택 상태에서 `e`/`i` 편집은 아직 커서 항목 하나만 연다 (여러 개 동시 편집은 의미가 크지 않아 보류)

---

## 18. 배포 아키텍처 확정 (2026-09-07)

> GitHub → Cloudflare Pages(정적 프론트) / AWS Lambda Function URL(백엔드).
> **API Gateway는 쓰지 않는다.**

- [x] **D14. API Gateway 생략, Lambda Function URL 직접 사용**
    - 라우팅은 이미 `src/api.js`의 `route()`가 전부 처리한다 (method+path 파싱, 리소스 매핑 불필요)
    - 인증은 API Gateway 인가자가 아니라 앱 레벨 고정 bearer 토큰(D13)이라 IAM/Cognito 통합이 필요 없다
    - CORS는 Function URL 네이티브 CORS 설정으로 끝난다 — OPTIONS 프리플라이트를 코드로 안 짜도 된다
    - 커스텀 도메인·WAF·스로틀링처럼 API Gateway가 주는 이점 중 쓸 게 없다 (개인용 단일 엔드포인트)
    - 결론: 리소스 하나(Lambda)로 끝난다. 나중에 필요해지면 Function URL 앞에 API Gateway를 얹는 건
      언제든 가능하니 지금 미리 놓을 이유가 없다
- [x] **`backend/` 폴더 삭제** — 옛 Sheets 핸들러와 미사용 npm 의존성(googleapis, @aws-sdk).
      `lambda.mjs` 를 저장소 루트에 두고 `src/*.js` 를 그대로 import한다.
      **npm 의존성이 0개라 zip에 `node_modules`가 필요 없다** (D13에서 googleapis 대신 fetch만 쓰기로 한 결정의 결과).
- [x] **정적 프론트를 `public/` 로 이동** (index.html, app.js, styles.css, manifest, sw.js, config.example.js).
      Cloudflare Pages의 "빌드 출력 디렉터리"를 `public` 으로 잡으면 src/·test/·scripts/ 가 배포물에 안 섞인다.
- [x] `src/auth.js` — 고정 bearer 토큰 검사. dev-server와 Lambda가 같은 함수를 쓴다
- [x] `lambda.mjs` — Function URL 이벤트를 `route()` 호출로 바꾸는 얇은 어댑터. 워밈 스타트 간 `api` 싱글턴 재사용
- [x] `scripts/build-lambda.mjs` — `dist/lambda/`에 `lambda.mjs`→`index.mjs` + `src/*.js` 복사 (의존성 0개, npm install 불필요)
- [x] `scripts/deploy-lambda.ps1` — zip(`Compress-Archive`) + `aws lambda` CLI로 IAM 역할·함수·Function URL을
      **멱등하게** 생성/갱신. `.env`에 `API_TOKEN`이 없으면 랜덤 값을 만들어 넣어준다
    - native exe(aws.exe) 종료 코드는 `$ErrorActionPreference`의 영향을 안 받으므로 전부 `$LASTEXITCODE`로 판별
- [x] `scripts/build-static.mjs` — Cloudflare Pages 빌드 명령. `public/config.js`(환경변수로부터) +
      `public/query.js`(src/query.js 복사) 를 만든다. **토큰을 저장소에 커밋하지 않으면서** 배포 시점 값을 심는 방법.
      로컬 dev-server는 이 복사 없이 `src/query.js`를 직접 서빙해 항상 최신 소스를 쓴다
- [x] `app.js` — `window.NZASSIST_CONFIG.apiBaseUrl`/`apiToken` 을 읽어 다른 origin(Lambda Function URL)도
      호출할 수 있게 함. 로컬은 `apiBaseUrl` 비워두면 같은 origin `/api` (dev-server) 그대로 동작
- [x] **배포 완료 (2026-09-08):** `nzassist-api` Lambda + Function URL 생성, 실계정으로 검증
    - `https://l4e3dtacfzcaaexcdlhfqln3qy0gdfpf.lambda-url.ap-northeast-2.on.aws/`
    - 토큰 없이 호출 → `401 unauthorized` / 정상 토큰 → 실제 Google Tasks 목록 반환 확인
    - **막혔던 지점:** zip에 `package.json`이 없으면 Lambda Node 22 런타임이 `src/*.js`를
      CommonJS로 취급해 `Named export 'GoogleApiError' not found` 로 죽는다 (실측 실패 로그로 확인).
      `{"type":"module"}` 만 있는 package.json 하나 추가로 해결 — 의존성은 여전히 0개
    - IAM 역할(`nzassist-lambda-role`, AWSLambdaBasicExecutionRole만 부착)도 스크립트가 자동 생성
    - CORS는 현재 `*` (임시) — Cloudflare Pages 도메인이 정해지면
      `deploy-lambda.ps1 -CorsOrigin "https://<project>.pages.dev"` 로 좁힐 것
- [ ] Cloudflare Pages 프로젝트 생성 후 GitHub 저장소 연결 (대시보드에서 1회 — API로 자동화 불가,
      GitHub App 설치·OAuth 승인이 필요해서다)
    - Build command: `node scripts/build-static.mjs`
    - Build output directory: `public`
    - 환경변수: `API_BASE_URL`(Function URL), `API_TOKEN`(deploy 스크립트 출력값)
- [ ] `git init` 첫 커밋 → `github.com/nzin4x/nzassist` push
- [ ] 상시 운영 전 OAuth 동의 화면을 `In production` 으로 전환 (Testing은 refresh token이 7일 만료 — Phase 1 참고)

---

## 19. JQL 풍 통합 검색 (완료, 2026-09-07)

> [`src/query.js`](src/query.js) · [`test/query.test.js`](test/query.test.js) — 21개 테스트

- [x] 자유단어 = 제목 부분일치 (대소문자 무시)
- [x] `#tag` / `@context` — 탭 필터와 AND 결합
- [x] `updated < 1d`, `created < 10d` — `<` `<=` `>` `>=`, 단위 `m h d w mo y`
    - **`created` 는 Tasks API에 없다** — `toTask()`가 생성 시 `created=<ISO>` 를 메타에 직접 찍는다 (task.js).
      이관 이전에 만들어진 native task는 `created` 가 없어 `created < Nd` 매칭에서 항상 거짓 — 의도된 동작
- [x] 명시적 `and`/`or`, 연속된 항은 암묵적 AND (JQL/구글 검색 관행)
- [x] `not`, 괄호 서브쿼리, 우선순위(`or` < `and` < `not`)
- [x] `#`/`@` 자동완성 — 입력창과 검색창이 같은 컨트롤러(`createSuggestController`)를 공유하도록 일반화
- [x] 문법이 깨진 채 타이핑 중이면(괄호 미완성 등) 조용히 마지막 유효 결과를 유지 — 매 키입력마다 에러 토스트가 뜨지 않는다
- [x] **실계정 검증:** 제목 부분일치, `updated < 1d`, `or` 결합, 괄호 오류 시 무너지지 않음, `@` 추천 전부 확인
- [x] `/` 는 검색창 포커스, `c` 는 입력창(할일 추가) 포커스로 **분리** — 예전엔 둘 다 같은 곳으로 갔었다
- [ ] `updated`/`created` 필드명 자동완성 (지금은 `#`/`@` 만 추천됨)
- [ ] sub-list(TAG 별 모아보기 전용 뷰)는 검색으로 대체 가능하다고 보고 별도 UI는 만들지 않음

---

## 20. 디자인 — Google Calendar 톤 (완료, 2026-09-07)

> [`public/styles.css`](public/styles.css) 전면 재작성

- [x] 배경 `#f6f8fc`(옅은 회색) + 흰 카드 + 파란 accent(`#1a73e8`, 구글 블루)
- [x] 카드형 elevation (옅은 그림자, hover 시 살짝 강조) — Material 스타일
- [x] 필터/리스트 칩을 pill 모양으로, 카테고리별 색 구분(when=파랑, ctx=초록, tag=빨강, rep=주황/보라)
- [x] 제안 카드를 "입력상자처럼 보이지 않게" — 카드 + 왼쪽 accent 바 형태로 이미 되어 있던 것을 색상만 새 팔레트로
- [x] 다크모드 팔레트도 구글 다크 테마 톤(#202124 배경)으로 맞춤
- [ ] macOS 메모 앱 스타일 첫 줄 볼드 + Shift+Enter 메모는 미착수 (§16-4)
- [ ] 글자수 한도 표시는 미착수 (§16-4)
