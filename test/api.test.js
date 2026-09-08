import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.js';
import { toTask, readMeta } from '../src/task.js';
import { parse } from '../src/parse.js';

// 실제 Google Tasks 대신 메모리 위에서 흉내낸다. api.js 는 이 인터페이스만 쓴다.
function fakeTasks(seed = []) {
  const lists = [{ id: 'L1', title: 'My Tasks' }, { id: 'L2', title: '집' }];
  const store = new Map(seed.map(t => [t.id, { ...t }]));
  let seq = 0;

  return {
    lists, store,
    listTaskLists: async () => lists,
    createTaskList: async title => { const l = { id: `L${lists.length + 1}`, title }; lists.push(l); return l; },
    deleteTaskList: async id => { const i = lists.findIndex(l => l.id === id); if (i >= 0) lists.splice(i, 1); },
    listTasks: async listId => [...store.values()].filter(t => t.listId === listId),
    getTask: async (listId, id) => { const t = store.get(id); if (!t) throw new Error('404'); return { ...t }; },
    insertTask: async (listId, body, params) => {
      const id = `t${++seq}`;
      const t = { id, listId, status: 'needsAction', ...body, ...(params?.parent ? { parent: params.parent } : {}) };
      store.set(id, t);
      return { ...t };
    },
    patchTask: async (listId, id, patch) => {
      const cur = store.get(id);
      const next = { ...cur, ...patch };
      if (patch.status === 'completed') next.completed = '2026-09-07T10:00:00.000Z';
      store.set(id, next);
      return { ...next };
    },
    deleteTask: async (listId, id) => { store.delete(id); }
  };
}

const build = (seed = []) => createApi({ tasks: fakeTasks(seed), settings: {} });

const seedTask = (over = {}) => {
  const parsed = parse(over.text ?? '할일 19:00', { now: new Date('2026-09-07T10:00:00+09:00') });
  return { id: over.id ?? 't1', listId: over.listId ?? 'L1', ...toTask(parsed, { userNotes: over.notes }) };
};

test('star를 켜고 끌 수 있다', async () => {
  const api = build([seedTask()]);
  const on = await api.star('L1', 't1', true);
  assert.equal(on.starred, true);
  const off = await api.star('L1', 't1', false);
  assert.equal(off.starred, false);
});

test('star 인자를 안 주면 토글된다', async () => {
  const api = build([seedTask()]);
  const a = await api.star('L1', 't1');
  const b = await api.star('L1', 't1');
  assert.equal(a.starred, true);
  assert.equal(b.starred, false);
});

test('postpone은 due만 밀고 시각(at)은 그대로 둔다', async () => {
  const api = build([seedTask()]); // due 2026-09-07, at 19:00
  const r = await api.postpone('L1', 't1', '2d');
  assert.equal(r.due, '2026-09-09');
  assert.equal(r.at, '19:00');
});

test('postpone: due가 없는(someday) task는 오늘부터 민다', async () => {
  const noDate = { id: 't2', listId: 'L1', ...toTask(parse('언젠가', { now: new Date('2026-09-07T10:00:00+09:00') })) };
  delete noDate.due;
  const api = build([noDate]);
  const r = await api.postpone('L1', 't2', '1w', { now: new Date('2026-09-07T10:00:00+09:00') });
  assert.equal(r.due, '2026-09-14');
});

test('하위 task를 추가하면 parent가 붙는다', async () => {
  const api = build([seedTask()]);
  const child = await api.addSubtask('L1', 't1', '세부 항목');
  assert.equal(child.parent, 't1');
  assert.equal(child.title, '세부 항목');
});

test('완료 + 반복이면 다음 회차가 생기고, star는 새 회차로 넘어가지 않는다', async () => {
  const api = build([seedTask({ text: '정수기 필터 every! 3 month' })]);
  await api.star('L1', 't1', true);
  const r = await api.complete('L1', 't1');
  assert.equal(r.next.starred, false);
});

test('delete list — 이름으로 찾아 지운다', async () => {
  const api = build([]);
  const r = await api.deleteList('집');
  assert.equal(r.deleted, '집');
  assert.deepEqual((await api.lists({ fresh: true })).map(l => l.title), ['My Tasks']);
});

test('delete list — 없는 이름이면 404', async () => {
  const api = build([]);
  await assert.rejects(() => api.deleteList('존재안함'), /404|찾을 수 없습니다/);
});

test('제목 클릭 편집(text)이 시각·반복까지 다시 파싱한다', async () => {
  const api = build([seedTask({ text: '가습기 청소 19:00' })]);
  const r = await api.update('L1', 't1', { text: '가습기 청소 every! 2 weeks 21:00' });
  assert.equal(r.title, '가습기 청소');
  assert.equal(r.at, '21:00');
  assert.equal(r.repeat.interval, '2w');
  assert.equal(r.repeat.mode, 'after');
});
