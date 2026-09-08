// 실제 Todoist 데이터 전체에 파서를 돌려 커버리지를 본다.
//
//   node scripts/parser-coverage.mjs
//
// scripts/todoist-export.mjs 를 먼저 실행해 data/todoist-export/tasks.json 이 있어야 한다.
// 마이그레이션 전에 "무엇을 못 읽는지"를 눈으로 확인하는 용도다.

import { readFile } from 'node:fs/promises';
import { parse } from '../src/parse.js';

const tasks = JSON.parse(await readFile('data/todoist-export/tasks.json', 'utf8'));
const recurring = tasks.filter(t => t.due?.is_recurring);

const seen = new Map();
for (const t of recurring) {
  const s = t.due.string;
  if (!seen.has(s)) seen.set(s, { count: 0, sample: t });
  seen.get(s).count++;
}

const ok = [];
const relativeOnly = [];
const missed = [];

for (const [str, { count, sample }] of seen) {
  const r = parse(str, { now: new Date() });
  const row = { str, count, parsed: r, sample };
  // 반복 문장인데 repeat이 안 나오면 마이그레이션에서 반복성이 사라진다.
  if (r.repeat) ok.push(row);
  // "2주후에" 처럼 상대 표현으로만 읽히는 것들. Todoist가 is_recurring이라 했으니
  // 마이그레이션에서 간격으로 승격시키면 된다 — 못 읽은 것이 아니다.
  else if (r.relativeInterval) relativeOnly.push(row);
  else missed.push(row);
}

const pct = n => `${((n / seen.size) * 100).toFixed(0)}%`;

console.log(`반복 문장 ${seen.size}종 / task ${recurring.length}건\n`);

console.log(`읽은 것 ${ok.length}종 (${pct(ok.length)})`);
for (const { str, count, parsed } of ok.sort((a, b) => b.count - a.count)) {
  const mode = parsed.repeat.mode === 'after' ? '완료기준' : '고정   ';
  console.log(`  ${String(count).padStart(3)}×  ${mode}  ${parsed.repeat.interval.padEnd(5)} ${(parsed.repeat.rrule ?? '-').padEnd(38)} ← ${str}`);
}

if (relativeOnly.length) {
  console.log(`\n상대 표현으로 읽힘 ${relativeOnly.length}종 — 마이그레이션에서 간격으로 승격`);
  for (const { str, count, parsed } of relativeOnly) {
    console.log(`  ${String(count).padStart(3)}×  ${parsed.relativeInterval.interval.padEnd(5)} ← ${str}`);
  }
}

if (missed.length) {
  console.log(`\n못 읽은 것 ${missed.length}종 (${pct(missed.length)})`);
  for (const { str, count, sample } of missed.sort((a, b) => b.count - a.count)) {
    console.log(`  ${String(count).padStart(3)}×  ${str}`);
    console.log(`        예: ${sample.content.slice(0, 60)}`);
  }
} else {
  console.log('\n못 읽은 것 없음.');
}

// 제목에 이미 @ 가 들어있는 경우 — 마이그레이션에서 컨텍스트로 오인될 수 있다.
const atInTitle = tasks.filter(t => /(^|\s)@\S/.test(t.content));
if (atInTitle.length) {
  console.log(`\n제목에 @ 가 있는 task ${atInTitle.length}건 — 컨텍스트로 해석된다. 확인 필요:`);
  for (const t of atInTitle.slice(0, 15)) console.log(`   ${t.content.slice(0, 70)}`);
  if (atInTitle.length > 15) console.log(`   ... 외 ${atInTitle.length - 15}건`);
}

// 제목에 # 가 들어있는 경우 — 태그로 해석된다.
const hashInTitle = tasks.filter(t => /(^|\s)#\S/.test(t.content));
if (hashInTitle.length) {
  console.log(`\n제목에 # 가 있는 task ${hashInTitle.length}건 — 태그로 해석된다:`);
  for (const t of hashInTitle.slice(0, 10)) console.log(`   ${t.content.slice(0, 70)}`);
}
