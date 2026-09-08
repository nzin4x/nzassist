// Google Tasks API가 정말 시각을 못 다루는지 직접 확인한다.
//
//   node --env-file=.env scripts/tasks-probe.mjs           # 읽기만
//   node --env-file=.env scripts/tasks-probe.mjs --write    # 시각 넣은 task를 만들어보고 지운다
//
// 문서에는 "It isn't possible to read or write the time that a task is scheduled for
// using the API" 라고 되어 있지만, 내부 Sync API 페이로드에는 시각이 들어 있었다.
// 문서가 낡았을 수 있으므로 실측으로 끝낸다.

import { tasksFromEnv, GoogleApiError } from '../src/google.js';

const write = process.argv.includes('--write');
const tasks = tasksFromEnv();

const fail = e => {
  if (e instanceof GoogleApiError && e.reason === 'accessNotConfigured') {
    console.error('Google Tasks API가 이 프로젝트에서 꺼져 있습니다. 콘솔에서 켜세요:');
    console.error('https://console.developers.google.com/apis/api/tasks.googleapis.com/overview?project=223913157392');
  } else if (e instanceof GoogleApiError && e.status === 401) {
    console.error('tasks scope가 없습니다. 재인증하세요: node --env-file=.env scripts/google-auth.mjs');
  } else {
    console.error(e.message);
  }
  process.exit(1);
};

console.log('1) task 목록(tasklist)');
const lists = await tasks.listTaskLists().catch(fail);
for (const l of lists) console.log(`   ${l.title}  (${l.id})`);
if (!lists.length) { console.error('tasklist가 없습니다.'); process.exit(1); }

const listId = lists[0].id;

console.log(`\n2) "${lists[0].title}" 의 기존 task — UI에서 시각을 넣은 것이 있으면 due를 본다`);
const items = await tasks.listTasks(listId, { showCompleted: 'true', maxResults: '100' }).catch(fail);
console.log(`   ${items.length}건`);
for (const t of items.slice(0, 12)) {
  console.log(`   due=${String(t.due ?? '-').padEnd(26)} status=${String(t.status).padEnd(11)} ${t.title?.slice(0, 40)}`);
}

// 여기가 핵심이다. UI에서 "오후 4시 30분" 으로 만든 task가 API로 어떻게 보이는가.
const withTime = items.filter(t => t.due && !/T00:00:00/.test(t.due));
console.log(`\n   → due에 00:00:00 이 아닌 시각이 담긴 task: ${withTime.length}건`);
for (const t of withTime.slice(0, 5)) console.log(`      ${t.due}  ${t.title?.slice(0, 40)}`);

if (!write) {
  console.log('\n(읽기만 했습니다. 쓰기 검증은 --write 를 붙이세요.)');
  process.exit(0);
}

console.log('\n3) 시각을 넣어 task 생성 시도');
const wanted = '2026-09-08T19:00:00.000Z';
const created = await tasks.insertTask(listId, {
  title: 'nzassist 시각 테스트',
  notes: 'nz_probe=1\nnotes 필드가 메타데이터 저장소로 쓸 만한지 함께 확인',
  due: wanted
}).catch(fail);

console.log(`   보낸 due : ${wanted}`);
console.log(`   받은 due : ${created.due}`);
console.log(`   notes    : ${JSON.stringify(created.notes)}`);
console.log(`\n   → ${created.due === wanted ? '시각이 보존됩니다. 문서가 낡았습니다.' : '시각이 잘립니다. 문서대로입니다.'}`);

console.log('\n4) PATCH로 시각만 다시 밀어넣기 시도');
const patched = await tasks.patchTask(listId, created.id, { due: '2026-09-08T21:30:00.000Z' }).catch(fail);
console.log(`   보낸 due : 2026-09-08T21:30:00.000Z`);
console.log(`   받은 due : ${patched.due}`);

await tasks.deleteTask(listId, created.id).catch(fail);
console.log('\n5) 테스트 task 삭제 완료');
