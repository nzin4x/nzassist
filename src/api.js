// nzassist API 라우트. dev 서버와 Lambda가 이 모듈을 공유한다.
//
// 저장소는 Google Tasks이고, 이 계층은 파싱 → 리스트 해석 → CRUD 만 한다.

import { parse } from './parse.js';
import { toTask, readNotes, writeNotes, readMeta, isManaged, scheduledAt, toDue, patchMeta } from './task.js';
import { nextDue } from './repeat.js';
import { syncCompanion } from './companion.js';
import { SEOUL_OFFSET_MIN } from './civil.js';
import { resolveSnooze, SNOOZE_PRESETS } from './snooze.js';


const norm = s => String(s ?? '')
  .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
  .replace(/[\s_\-·.]/g, '')
  .toLowerCase();

export function createApi({ tasks, calendar, settings = {} }) {
  const defaults = { defaultTime: '09:00', timeZone: 'Asia/Seoul', ...settings };
  const offsetMin = SEOUL_OFFSET_MIN;

  const listCache = { at: 0, items: [] };
  async function lists({ fresh = false } = {}) {
    if (!fresh && Date.now() - listCache.at < 30_000) return listCache.items;
    listCache.items = await tasks.listTaskLists();
    listCache.at = Date.now();
    return listCache.items;
  }

  /** @context 를 리스트로 해석한다. 없으면 만든다 (D3). */
  async function resolveList(context) {
    const all = await lists();
    if (!context) return all[0];
    const hit = all.find(l => norm(l.title) === norm(context));
    if (hit) return hit;
    const created = await tasks.createTaskList(context);
    listCache.at = 0;
    return created;
  }

  /** 화면에 뿌리기 좋은 형태로 정리한다. */
  function shape(task, list) {
    const { userNotes, meta } = readNotes(task.notes);
    return {
      id: task.id,
      listId: list.id,
      listTitle: list.title,
      title: task.title ?? '',
      due: task.due ? task.due.slice(0, 10) : null,
      at: meta.at ?? null,
      scheduledAt: scheduledAt(task),
      completed: task.status === 'completed',
      completedAt: task.completed ?? null,
      starred: meta.starred === '1',
      parent: task.parent ?? null,
      notes: userNotes,
      meta,
      managed: isManaged(task),
      repeat: meta.rep ? { interval: meta.rep, mode: meta.rep_mode ?? 'fixed' } : null,
      // JQL 검색용 (src/query.js): tags/context/updatedAt/createdAt
      tags: meta.tags ? meta.tags.split(',').filter(Boolean) : [],
      context: meta.context ?? null,
      updatedAt: task.updated ?? null,
      createdAt: meta.created ?? null
    };
  }

  /**
   * 동반 이벤트를 task 상태에 맞추고, 이벤트 id를 notes에 되쓴다 (D6).
   * Calendar 클라이언트가 없으면 조용히 건너뛴다.
   */
  async function withCompanion(shaped, list) {
    if (!calendar) return shaped;
    try {
      const { gcal, changed } = await syncCompanion(calendar, shaped, {
        timeZone: defaults.timeZone,
        pwaBaseUrl: defaults.pwaBaseUrl
      });
      if (!changed || gcal === (shaped.meta.gcal ?? null)) return shaped;
      const current = await tasks.getTask(shaped.listId, shaped.id);
      const updated = await tasks.patchTask(shaped.listId, shaped.id, patchMeta(current, { gcal: gcal ?? '' }));
      return shape(updated, list);
    } catch (e) {
      // 알람 생성 실패가 할 일 저장을 되돌리게 두지 않는다
      return { ...shaped, companionError: e.message };
    }
  }

  return {
    lists,

    async allTasks({ listId, showCompleted = false } = {}) {
      const all = await lists();
      const targets = listId ? all.filter(l => l.id === listId) : all;
      const out = [];
      for (const list of targets) {
        const items = await tasks.listTasks(list.id, {
          showCompleted: String(showCompleted),
          showHidden: String(showCompleted),
          maxResults: '100'
        });
        for (const t of items) out.push(shape(t, list));
      }
      // 날짜 없는 항목은 뒤로 보낸다
      return out.sort((a, b) => (a.scheduledAt ?? '9999').localeCompare(b.scheduledAt ?? '9999'));
    },

    /** 한 줄 입력을 해석만 한다. 저장하지 않는다 — 제안 카드용. */
    preview(text, now = new Date()) {
      const parsed = parse(text, { now, ...defaults });
      return {
        title: parsed.title,
        context: parsed.context,
        tags: parsed.tags,
        scheduledAt: parsed.start.dateTime,
        repeat: parsed.repeat && { interval: parsed.repeat.interval, mode: parsed.repeat.mode },
        warnings: parsed.warnings
      };
    },

    async create(text, { now = new Date(), userNotes = '', listId } = {}) {
      const parsed = parse(text, { now, ...defaults });
      const list = listId ? (await lists()).find(l => l.id === listId) : await resolveList(parsed.context);
      const body = toTask(parsed, { userNotes });
      const created = await tasks.insertTask(list.id, body);
      return withCompanion(shape(created, list), list);
    },

    /**
     * 편집. at 을 바꾸면 동반 이벤트가 따라 움직인다 ("Add time").
     * at: null / '' 을 주면 시각을 지우고 알람도 없앤다.
     */
    async update(listId, id, changes) {
      const all = await lists();
      const list = all.find(l => l.id === listId);
      const current = await tasks.getTask(listId, id);
      const { userNotes, meta } = readNotes(current.notes);
      const patch = {};

      // text 를 주면 한 줄 입력을 다시 파싱한다 (제목 클릭 편집 경로).
      // 별도 편집 폼 대신 입력 기반으로 간다.
      if (changes.text !== undefined) {
        const parsed = parse(changes.text, { now: new Date(), ...defaults });
        changes = {
          ...changes,
          title: parsed.title,
          due: parsed.start.dateTime.slice(0, 10),
          at: parsed.start.dateTime.slice(11, 16),
          context: parsed.context ?? meta.context,
          ...(parsed.repeat ? { rep: parsed.repeat.interval, rep_mode: parsed.repeat.mode } : {})
        };
      }

      if (changes.title !== undefined) patch.title = changes.title;
      if (changes.due !== undefined) patch.due = changes.due ? toDue(changes.due) : null;

      const metaChanges = {};
      for (const key of ['at', 'dur', 'context', 'rep', 'rep_mode']) {
        if (changes[key] !== undefined) metaChanges[key] = changes[key] || '';
      }
      if (changes.notes !== undefined || Object.keys(metaChanges).length) {
        patch.notes = writeNotes(changes.notes ?? userNotes, { ...meta, ...metaChanges });
      }

      const updated = await tasks.patchTask(listId, id, patch);
      return withCompanion(shape(updated, list), list);
    },

    /**
     * 완료 처리. 반복이면 다음 회차를 만든다 (D7/D8).
     * 완료일은 Tasks가 기록하는 completed 타임스탬프를 그대로 쓴다.
     */
    async complete(listId, id, { now = new Date() } = {}) {
      const all = await lists();
      const list = all.find(l => l.id === listId);
      const current = await tasks.getTask(listId, id);
      const done = await tasks.patchTask(listId, id, { status: 'completed' });

      const meta = readMeta(current);
      // 완료했으면 알람도 치운다
      const doneShaped = await withCompanion(shape(done, list), list);
      if (!meta.rep) return { completed: doneShaped, next: null };

      const due = nextDue({
        rep: meta.rep,
        mode: meta.rep_mode,
        previousDue: current.due?.slice(0, 10),
        completedAt: done.completed ?? now.toISOString(),
        byday: meta.rep_byday,
        monthday: meta.rep_monthday
      });

      const { userNotes } = readNotes(current.notes);
      const next = await tasks.insertTask(listId, {
        title: current.title,
        due: toDue(due),
        // 다음 회차는 자기 알람을 새로 만든다. 이전 회차의 gcal을 물려받으면 안 된다.
        // starred 처럼 회차마다 초기화돼야 하는 값은 넘기지 않는다
        notes: writeNotes(userNotes, {
          ...meta, gcal: '', starred: '', seq: String(Number(meta.seq ?? 0) + 1), last_completed: done.completed
        })
      });

      return { completed: doneShaped, next: await withCompanion(shape(next, list), list) };
    },

    async uncomplete(listId, id) {
      const list = (await lists()).find(l => l.id === listId);
      return shape(await tasks.patchTask(listId, id, { status: 'needsAction' }), list);
    },

    /** star 토글. Tasks API에 star가 없어 starred= 메타로 대신한다. */
    async star(listId, id, on) {
      const list = (await lists()).find(l => l.id === listId);
      const current = await tasks.getTask(listId, id);
      const value = on === undefined ? (readMeta(current).starred === '1' ? '' : '1') : (on ? '1' : '');
      return shape(await tasks.patchTask(listId, id, patchMeta(current, { starred: value })), list);
    },

    /**
     * 스누즈 — 절대 시각(분 단위까지)으로 옮긴다. postpone과 달리 시각(at)도 함께 바꾸고
     * 동반 알람을 그 시각으로 다시 만든다 — 애초에 "다시 울리게" 하는 게 목적이라
     * 시각이 안 바뀌면 스누즈가 아니다.
     * @param {string} input  '10분 후' 같은 프리셋 문구, 또는 '10m'/'2d'/'내일 9시' 같은 커스텀 입력
     */
    async snooze(listId, id, input, { now = new Date() } = {}) {
      const list = (await lists()).find(l => l.id === listId);
      const current = await tasks.getTask(listId, id);
      const { userNotes, meta } = readNotes(current.notes);
      const { dateTime } = resolveSnooze(input, { now, offsetMin, defaultTime: defaults.defaultTime, timeZone: defaults.timeZone });
      const updated = await tasks.patchTask(listId, id, {
        due: toDue(dateTime),
        notes: writeNotes(userNotes, { ...meta, at: dateTime.slice(11, 16) })
      });
      return withCompanion(shape(updated, list), list);
    },

    snoozePresets: () => SNOOZE_PRESETS,

    /** 하위 task 추가. parent는 쿼리 파라미터로 넘긴다 (실측). */
    async addSubtask(listId, parentId, text) {
      const list = (await lists()).find(l => l.id === listId);
      const parsed = parse(text, { now: new Date(), ...defaults });
      const created = await tasks.insertTask(list.id, toTask(parsed, {}), { parent: parentId });
      return shape(created, list);
    },

    async remove(listId, id) {
      await tasks.deleteTask(listId, id);
      return { ok: true };
    },

    /** 명령 팔레트의 "delete list <name>" 용. 리스트 자체를 지운다 — 되돌릴 수 없다. */
    async deleteList(nameOrId) {
      const all = await lists();
      const list = all.find(l => l.id === nameOrId) ?? all.find(l => l.title === nameOrId);
      if (!list) throw Object.assign(new Error(`리스트를 찾을 수 없습니다: ${nameOrId}`), { status: 404 });
      await tasks.deleteTaskList(list.id);
      listCache.at = 0;
      return { ok: true, deleted: list.title };
    }
  };
}

/** HTTP 메서드/경로를 API 호출로 옮긴다. dev 서버와 Lambda가 공유한다. */
export async function route(api, method, pathname, query, body) {
  const seg = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  if (method === 'GET' && seg[0] === 'lists') return api.lists({ fresh: query.fresh === '1' });
  if (method === 'DELETE' && seg[0] === 'lists' && seg[1]) return api.deleteList(decodeURIComponent(seg[1]));

  if (method === 'GET' && seg[0] === 'tasks' && seg.length === 1) {
    return api.allTasks({ listId: query.list, showCompleted: query.completed === '1' });
  }

  if (method === 'POST' && seg[0] === 'preview') return api.preview(body.text);
  if (method === 'GET' && seg[0] === 'snooze-presets') return api.snoozePresets();
  if (method === 'POST' && seg[0] === 'tasks' && seg.length === 1) {
    return api.create(body.text, { userNotes: body.notes, listId: body.list });
  }

  // /api/tasks/{listId}/{taskId}[/complete|/uncomplete|/star|/snooze|/subtask]
  if (seg[0] === 'tasks' && seg.length >= 3) {
    const [, listId, taskId, action] = seg;
    if (method === 'POST' && action === 'complete') return api.complete(listId, taskId);
    if (method === 'POST' && action === 'uncomplete') return api.uncomplete(listId, taskId);
    if (method === 'POST' && action === 'star') return api.star(listId, taskId, body.on);
    if (method === 'POST' && action === 'snooze') return api.snooze(listId, taskId, body.input);
    if (method === 'POST' && action === 'subtask') return api.addSubtask(listId, taskId, body.text);
    if (method === 'PATCH') return api.update(listId, taskId, body);
    if (method === 'DELETE') return api.remove(listId, taskId);
  }

  const err = new Error(`알 수 없는 경로: ${method} ${pathname}`);
  err.status = 404;
  throw err;
}
