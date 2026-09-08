// Todoist 전체 덤프.
//
//   node --env-file=.env scripts/todoist-export.mjs
//
// CSV export보다 API가 낫다. project / label / due.string / 반복 여부를
// 구조화된 형태로 한 번에 받을 수 있다. CSV는 대조용으로만 따로 보관한다.
//
// 결과는 data/todoist-export/ 아래에 떨어지고, 이 경로는 gitignore 대상이다.

import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://api.todoist.com/api/v1';
const OUT = 'data/todoist-export';

const token = process.env.TODOIST_API_TOKEN;
if (!token) {
  console.error('.env 에 TODOIST_API_TOKEN 이 없습니다.');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path, params = {}) {
  const out = [];
  let cursor;
  do {
    const q = new URLSearchParams({ ...params, limit: '200', ...(cursor ? { cursor } : {}) });
    const url = `${BASE}${path}?${q}`;

    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (res.status !== 429 && res.status < 500) break;
      if (attempt >= 4) break;
      await sleep(1000 * 2 ** attempt);
    }

    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
    const body = await res.json();

    // v1 목록 응답은 { results, next_cursor } 형태다. 옛 형태(배열)도 받아준다.
    if (Array.isArray(body)) return body;
    out.push(...(body.results ?? []));
    cursor = body.next_cursor;
  } while (cursor);
  return out;
}

await mkdir(OUT, { recursive: true });

const save = async (name, data) => {
  await writeFile(`${OUT}/${name}.json`, JSON.stringify(data, null, 2), 'utf8');
  console.log(`   ${name.padEnd(10)} ${String(data.length).padStart(5)}건  → ${OUT}/${name}.json`);
};

console.log('Todoist 덤프 중...');
const [projects, tasks, labels, sections] = await Promise.all([
  get('/projects'),
  get('/tasks'),
  get('/labels'),
  get('/sections')
]);

await save('projects', projects);
await save('tasks', tasks);
await save('labels', labels);
await save('sections', sections);

// --- 통계 ---
const byId = Object.fromEntries(projects.map(p => [p.id, p.name]));
const recurring = tasks.filter(t => t.due?.is_recurring);
const afterCompletion = recurring.filter(t => /every!/i.test(t.due?.string ?? ''));
// v1의 due.date는 이미 해결된 값이고, 시각이 있으면 "2025-09-23T07:00:00" 처럼 T가 붙는다.
// (v2의 due.datetime 은 v1에 없다 — 이걸 보면 항상 0이 나온다.)
const withTime = tasks.filter(t => t.due?.date?.includes('T'));
const withDeadline = tasks.filter(t => t.deadline);
const korean = tasks.filter(t => t.due?.lang === 'ko');

console.log('\n통계');
console.log(`   프로젝트        ${projects.length}`);
console.log(`   활성 task       ${tasks.length}`);
console.log(`   라벨            ${labels.length}`);
console.log(`   반복 task       ${recurring.length}`);
console.log(`   그 중 every!    ${afterCompletion.length}  ← 완료 기준. normalizer가 직접 계산해야 하는 것들`);
console.log(`   시각 있는 task  ${withTime.length}`);
console.log(`   deadline 있음   ${withDeadline.length}`);
console.log(`   한국어 due 문장 ${korean.length}`);

console.log('\n프로젝트별 task 수');
const counts = {};
for (const t of tasks) counts[byId[t.project_id] ?? t.project_id] = (counts[byId[t.project_id] ?? t.project_id] ?? 0) + 1;
for (const [name, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(4)}  ${name}`);
}

console.log('\n반복 문장 종류 (파서가 전부 처리해야 하는 것들)');
const strings = {};
for (const t of recurring) strings[t.due.string] = (strings[t.due.string] ?? 0) + 1;
for (const [s, n] of Object.entries(strings).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(3)}×  ${s}`);
}

console.log('\n라벨 (모두 #tag로 변환된다 — D4)');
console.log(`   ${labels.map(l => l.name).join(', ') || '(없음)'}`);
