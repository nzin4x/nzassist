// nzassist가 만든 항목만 골라 지운다. 마이그레이션을 되돌리는 안전장치다.
//
//   node --env-file=.env scripts/purge.mjs                      # 무엇이 지워질지만 본다
//   node --env-file=.env scripts/purge.mjs --batch=mig-20260907 # 특정 이관분만
//   node --env-file=.env scripts/purge.mjs --all --confirm      # 관리 항목 전부 삭제
//
// 판별 기준은 notes의 ---nzassist--- 블록이다. 손으로 만든 native task는 절대 건드리지 않는다.

import { tasksFromEnv, createCalendarClient, authFromEnv } from '../src/google.js';
import { readMeta, isManaged } from '../src/task.js';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const has = name => process.argv.includes(`--${name}`);

const batch = arg('batch');
const all = has('all');
const confirm = has('confirm');

if (!batch && !all) {
  console.log('대상을 지정하세요: --batch=<id> 또는 --all');
  process.exit(1);
}

const auth = authFromEnv();
const tasks = tasksFromEnv();
const cal = createCalendarClient(auth);

const lists = await tasks.listTaskLists();
const doomed = [];

for (const list of lists) {
  const items = await tasks.listTasks(list.id, { showCompleted: 'true', showHidden: 'true', maxResults: '100' });
  for (const t of items) {
    if (!isManaged(t)) continue;                          // native는 건드리지 않는다
    const meta = readMeta(t);
    if (batch && meta.batch !== batch) continue;
    doomed.push({ list, task: t, meta });
  }
}

console.log(`대상 ${doomed.length}건${batch ? ` (batch=${batch})` : ' (nzassist 관리 항목 전체)'}\n`);
for (const { list, task, meta } of doomed) {
  console.log(`  [${list.title}] ${task.title}`);
  console.log(`      due=${task.due?.slice(0, 10) ?? '-'} at=${meta.at ?? '-'} rep=${meta.rep ?? '-'} batch=${meta.batch ?? '-'}${meta.gcal ? ` gcal=${meta.gcal}` : ''}`);
}

const withEvent = doomed.filter(d => d.meta.gcal);
if (withEvent.length) console.log(`\n동반 캘린더 이벤트 ${withEvent.length}건도 함께 삭제됩니다.`);

if (!doomed.length) process.exit(0);

if (!confirm) {
  console.log('\n실제로 지우려면 --confirm 을 붙이세요. (지금은 아무것도 지우지 않았습니다)');
  process.exit(0);
}

let ok = 0;
let failed = 0;
for (const { list, task, meta } of doomed) {
  try {
    if (meta.gcal) await cal.deleteEvent(meta.gcal_cal || 'primary', meta.gcal).catch(() => {});
    await tasks.deleteTask(list.id, task.id);
    ok++;
  } catch (e) {
    failed++;
    console.error(`  실패: ${task.title} — ${e.message}`);
  }
}

console.log(`\n삭제 ${ok}건${failed ? ` · 실패 ${failed}건` : ''}`);
