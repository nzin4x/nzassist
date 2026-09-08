// Calendar 연결 확인용 스모크 테스트.
//
//   node --env-file=.env scripts/calendar-smoke.mjs            # dry-run (아무것도 안 쓴다)
//   node --env-file=.env scripts/calendar-smoke.mjs --write     # primary 캘린더에 실제로 만든다
//   node --env-file=.env scripts/calendar-smoke.mjs --write --keep   # 만들고 지우지 않는다
//
// --write 없이는 읽기만 하고 만들 이벤트 본문을 출력한다.

import { parse } from '../src/parse.js';
import { toEvent, readProps } from '../src/event.js';
import { clientFromEnv } from '../src/google.js';

const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const keep = args.has('--keep');

const SAMPLE = process.env.SMOKE_INPUT || 'nzassist 연결 테스트 in 10 min';

const client = clientFromEnv();

console.log('1) 캘린더 목록');
const calendars = await client.listCalendars();
for (const c of calendars) {
  console.log(`   ${c.primary ? '*' : ' '} ${c.summary}  (${c.id})  ${c.accessRole}`);
}

console.log(`\n2) 입력 파싱: "${SAMPLE}"`);
const parsed = parse(SAMPLE, { now: new Date() });
console.log('  ', JSON.stringify({ title: parsed.title, start: parsed.start.dateTime, repeat: parsed.repeat }, null, 0));
if (parsed.warnings.length) console.log('   경고:', parsed.warnings.join(' / '));

const event = toEvent(parsed, { baseUrl: process.env.PWA_BASE_URL, extra: { src: 'smoke' } });

console.log('\n3) 만들 이벤트 본문');
console.log(JSON.stringify(event, null, 2));

if (!write) {
  console.log('\n(dry-run입니다. 실제로 만들려면 --write 를 붙이세요.)');
  process.exit(0);
}

console.log('\n4) primary 캘린더에 생성');
const created = await client.insertEvent('primary', event);
console.log(`   생성됨: ${created.id}`);
console.log(`   링크: ${created.htmlLink}`);

console.log('\n5) 읽어서 대조');
const fetched = await client.getEvent('primary', created.id);
console.log('   summary:', fetched.summary);
console.log('   start  :', JSON.stringify(fetched.start));
console.log('   props  :', JSON.stringify(readProps(fetched)));
console.log('   알림   :', JSON.stringify(fetched.reminders));

// 시각이 그대로 살아 돌아오는지가 핵심이다. Tasks API가 못 하던 바로 그것.
// 보낼 때는 오프셋 없이 timeZone과 함께 보내고, 받을 때는 구글이 오프셋을 붙여 준다.
// 벽시계 부분만 떼어 비교한다.
const wall = s => s.replace(/([+-]\d{2}:\d{2}|Z)$/, '');
const sentTime = event.start.dateTime;
const gotTime = fetched.start.dateTime;
const same = wall(sentTime) === wall(gotTime);
console.log(`\n   보낸 시각 ${sentTime} / 받은 시각 ${gotTime} → ${same ? 'OK — 시각 보존됨' : '불일치!'}`);
if (!same) process.exitCode = 1;

if (!keep) {
  await client.deleteEvent('primary', created.id);
  console.log('\n6) 테스트 이벤트 삭제 완료 (남기려면 --keep)');
}
