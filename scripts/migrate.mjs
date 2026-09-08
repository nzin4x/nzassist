// Todoist -> Google Tasks 이관.
//
//   node --env-file=.env scripts/migrate.mjs                 # dry-run (계정에 쓰지 않는다)
//   node --env-file=.env scripts/migrate.mjs --confirm        # 실제 이관
//   node --env-file=.env scripts/migrate.mjs --min-tasks=5    # 리스트 신설 기준
//
// 되돌리기: node --env-file=.env scripts/purge.mjs --batch=<id> --confirm
//
// 리스트 정책 (D3 + D12): 기존 리스트를 먼저 재사용하고, 규모가 되는 프로젝트만 새로 만든다.
// 나머지는 기본 리스트로 보내고 notes의 context= 로만 구분한다.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tasksFromEnv } from '../src/google.js';
import { convert } from '../src/todoist.js';
import { readMeta, isManaged } from '../src/task.js';

const arg = (n, d) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const confirm = process.argv.includes('--confirm');
const MIN_TASKS = Number(arg('min-tasks', 5));
const BATCH = arg('batch', `mig-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);

const norm = s => String(s ?? '')
  .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
  .replace(/[\s_\-·.()[\]]/g, '')
  .toLowerCase();

const projects = JSON.parse(await readFile('data/todoist-export/projects.json', 'utf8'));
const todos = JSON.parse(await readFile('data/todoist-export/tasks.json', 'utf8'));

const tasks = tasksFromEnv();
const lists = await tasks.listTaskLists();
const primary = lists[0];

const count = {};
for (const t of todos) count[t.project_id] = (count[t.project_id] ?? 0) + 1;

// --- 리스트 매핑 ---
const mapping = new Map();
const toCreate = [];
for (const p of projects) {
  const n = count[p.id] ?? 0;
  if (n === 0) continue;
  const isInbox = p.is_inbox_project || /^inbox$/i.test(p.name);
  const hit = lists.find(l => norm(l.title) === norm(p.name));

  if (isInbox) mapping.set(p.id, { list: primary, how: 'primary(inbox)' });
  else if (hit) mapping.set(p.id, { list: hit, how: '기존 재사용' });
  else if (n >= MIN_TASKS) { mapping.set(p.id, { list: null, how: '신규 생성' }); toCreate.push(p); }
  else mapping.set(p.id, { list: primary, how: 'primary(소규모)' });
}

// --- 이미 이관된 것 건너뛰기 (멱등성) ---
const existing = new Set();
for (const l of lists) {
  for (const t of await tasks.listTasks(l.id, { showCompleted: 'true', showHidden: 'true', maxResults: '100' })) {
    if (isManaged(t)) {
      const id = readMeta(t).src_id;
      if (id) existing.add(id);
    }
  }
}

// --- 변환 ---
const now = new Date();
const rows = [];
const warnings = [];
let skipped = 0;

for (const t of todos) {
  if (existing.has(String(t.id))) { skipped++; continue; }
  const project = projects.find(p => p.id === t.project_id);
  const target = mapping.get(t.project_id);
  if (!target) continue;

  const { task, warnings: w } = convert(t, {
    context: project?.name,
    batch: BATCH,
    now
  });
  rows.push({ todoist: t, project: project?.name, target, task });
  for (const one of w) warnings.push({ content: t.content, warning: one });
}

// --- 리포트 ---
const meta = t => readMeta(t);
console.log(`배치 ${BATCH}\n`);
console.log(`Todoist ${todos.length}건 · 이관 대상 ${rows.length}건${skipped ? ` · 이미 이관됨 ${skipped}건 건너뜀` : ''}`);
console.log(`리스트: 기존 재사용 ${[...mapping.values()].filter(m => m.how === '기존 재사용').length} · 신규 ${toCreate.length} · 기본 리스트로 ${[...mapping.values()].filter(m => m.how.startsWith('primary')).length}\n`);

if (toCreate.length) {
  console.log('새로 만들 리스트');
  for (const p of toCreate) console.log(`   ${p.name}  (${count[p.id]}건)`);
  console.log();
}

const withTime = rows.filter(r => meta(r.task).at && meta(r.task).at !== '09:00');
const someday = rows.filter(r => !r.task.due);
const repeating = rows.filter(r => meta(r.task).rep);
console.log(`시각 지정 ${withTime.length} · 날짜 없음(someday) ${someday.length} · 반복 ${repeating.length}`);
console.log(`  그 중 완료 기준(every!) ${repeating.filter(r => meta(r.task).rep_mode === 'after').length}\n`);

console.log('변환 예시 (앞 12건)');
for (const r of rows.slice(0, 12)) {
  const m = meta(r.task);
  const when = r.task.due ? `${r.task.due.slice(0, 10)} ${m.at}` : '날짜없음      ';
  const rep = m.rep ? ` [${m.rep_mode === 'after' ? '완료기준' : '고정'} ${m.rep}]` : '';
  console.log(`  ${when}  ${r.target.list?.title ?? '(신규)'} ← ${r.project}`);
  console.log(`     ${r.task.title.slice(0, 66)}${rep}`);
}

if (warnings.length) {
  console.log(`\n확인 필요 ${warnings.length}건`);
  for (const w of warnings) console.log(`   ${w.warning}\n      ← ${w.content.slice(0, 60)}`);
}

await mkdir('data', { recursive: true });
await writeFile('data/migration-preview.json',
  JSON.stringify({ batch: BATCH, generatedAt: now.toISOString(), rows: rows.map(r => ({ project: r.project, list: r.target.list?.title ?? null, task: r.task })) }, null, 2), 'utf8');
console.log('\n미리보기 저장: data/migration-preview.json');

if (!confirm) {
  console.log('\n계정에는 아무것도 쓰지 않았습니다. 실제로 옮기려면 --confirm 을 붙이세요.');
  process.exit(0);
}

// --- 실제 이관 ---
console.log('\n이관 시작');
const created = new Map();
for (const p of toCreate) {
  const list = await tasks.createTaskList(p.name);
  created.set(p.id, list);
  console.log(`   리스트 생성: ${p.name}`);
  await new Promise(r => setTimeout(r, 400)); // 연속 생성 쿼터를 피한다
}

let ok = 0;
let failed = 0;
for (const r of rows) {
  const list = r.target.list ?? created.get(r.todoist.project_id);
  try {
    await tasks.insertTask(list.id, r.task);
    ok++;
    if (ok % 25 === 0) console.log(`   ${ok}/${rows.length}`);
  } catch (e) {
    failed++;
    console.error(`   실패: ${r.task.title.slice(0, 40)} — ${e.message}`);
  }
}

console.log(`\n완료: ${ok}건${failed ? ` · 실패 ${failed}건` : ''}`);
console.log(`되돌리기: node --env-file=.env scripts/purge.mjs --batch=${BATCH} --confirm`);
