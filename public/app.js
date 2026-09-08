// nzassist PWA.
// 저장소는 Google Tasks. 시각은 task.notes의 at= 이 원본이다 (Tasks의 due는 날짜만 담는다).
//
// 백엔드는 로컬에서는 dev-server(같은 origin), 배포 후에는 Lambda Function URL(다른 origin)이다.
// config.js가 apiBaseUrl을 채워주면 그쪽으로, 비어 있으면 같은 origin의 /api로 붙는다.

import { parseQuery, matches as matchesQuery } from './query.js';

const $ = id => document.getElementById(id);
const cfg = window.NZASSIST_CONFIG || {};
const API_ORIGIN = (cfg.apiBaseUrl || '').replace(/\/$/, '');
const API_BASE = `${API_ORIGIN}/api`;

const api = async (path, opts = {}) => {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    credentials: 'include',
    headers: {
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(cfg.apiToken ? { authorization: `Bearer ${cfg.apiToken}` } : {})
    }
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
};

const auth = { authenticated: false, user: null };

async function refreshAuth() {
  const res = await fetch(`${API_ORIGIN}/auth/me`, { credentials: 'include' });
  if (!res.ok) throw new Error('로그인 상태를 확인하지 못했습니다.');
  const body = await res.json();
  auth.authenticated = Boolean(body.authenticated);
  auth.user = body.user ?? null;
  $('login').classList.toggle('hidden', auth.authenticated);
  $('logout').classList.toggle('hidden', !auth.authenticated);
  $('account-name').textContent = auth.user?.name || auth.user?.email || '';
  $('account-name').classList.toggle('hidden', !auth.authenticated);
}

const state = {
  tasks: [], lists: [], tags: new Set(), filter: 'today', listId: null,
  shown: [],            // 현재 화면에 보이는 순서 (star 정렬 반영)
  cursor: 0,            // j/k 로 움직이는 위치
  selected: new Set(),  // Ctrl+클릭 다건 선택 (key = `${listId}/${id}`)
  mode: 'nav',          // 'nav' | 'input' | 'search' | 'isearch' — 키 처리를 가른다
  isearch: null,        // f 로 시작한 incremental search 질의
  query: null,          // 상단 통합 검색창의 JQL AST (src/query.js)
  focusedKey: null,     // /t/{taskId} deep link로 들어온 단건
  undoStack: []         // { label, undo: async fn }
};
let pickedFilter = false; // 사용자가 직접 고른 뒤로는 자동 전환하지 않는다

const keyOf = t => `${t.listId}/${t.id}`;
const toggleSelect = key => {
  state.selected.has(key) ? state.selected.delete(key) : state.selected.add(key);
  render();
};
const selectedTasks = () =>
  state.selected.size ? state.tasks.filter(t => state.selected.has(keyOf(t)))
    : (state.shown[state.cursor] ? [state.shown[state.cursor]] : []);

function pushUndo(label, undo) {
  state.undoStack.push({ label, undo });
  if (state.undoStack.length > 20) state.undoStack.shift();
}

async function undo() {
  const entry = state.undoStack.pop();
  if (!entry) return setStatus('되돌릴 것이 없습니다', false);
  setStatus(`되돌리는 중: ${entry.label}`);
  await entry.undo();
  await load();
  setStatus(`되돌림: ${entry.label}`);
}

const pad = n => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const FILTERS = {
  overdue: t => t.due && t.due < todayStr(),
  today: t => t.due === todayStr(),
  week: t => t.due && t.due >= todayStr() && t.due <= addDays(todayStr(), 7),
  someday: t => !t.due,
  all: () => true
};

const setStatus = (text, ok = true) => {
  $('status').textContent = text;
  $('status-dot').classList.toggle('bad', !ok);
};

// ---------------------------------------------------------------- 렌더
function render() {
  const inList = state.listId ? state.tasks.filter(t => t.listId === state.listId) : state.tasks;

  for (const [name, fn] of Object.entries(FILTERS)) {
    const el = $(`n-${name}`);
    if (el) el.textContent = inList.filter(fn).length;
  }

  let shown = inList.filter(FILTERS[state.filter]);
  // 상단 통합 검색 — 탭 필터와 AND로 결합된다
  if (state.query) shown = shown.filter(t => matchesQuery(state.query, t));
  // f — incremental search: 눈에 보이는 것 중에서만 빠르게 좁힌다
  if (state.isearch) {
    const q = state.isearch.toLowerCase();
    shown = shown.filter(t => t.title.toLowerCase().includes(q));
  }
  // star는 항상 위로
  shown = shown.slice().sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0));
  state.shown = shown;
  if (state.cursor >= shown.length) state.cursor = shown.length - 1;

  const box = $('task-list');
  box.innerHTML = '';
  $('empty').classList.toggle('hidden', shown.length > 0);

  shown.forEach((t, i) => {
    const row = document.createElement('article');
    const key = `${t.listId}/${t.id}`;
    row.className = `task${t.due && t.due < todayStr() ? ' overdue' : ''}`
      + `${state.selected.has(key) ? ' is-selected' : ''}`
      + `${state.focusedKey === key ? ' is-focused' : ''}`
      + `${i === state.cursor ? ' is-cursor' : ''}`;
    row.dataset.key = key;
    row.onclick = e => {
      if (e.target.closest('button, input, .task-title')) return;
      if (e.ctrlKey || e.metaKey) toggleSelect(key);
      else { state.cursor = i; render(); }
    };

    const check = document.createElement('button');
    check.className = 'check';
    check.title = '완료';
    check.onclick = () => complete(t);

    const main = document.createElement('div');
    main.className = 'task-main';

    const title = document.createElement('div');
    title.className = 'task-title';
    if (t.starred) { const s = document.createElement('span'); s.className = 'star'; s.textContent = '★ '; title.append(s); }
    title.append(document.createTextNode(t.title));
    title.title = '클릭하면 편집';
    title.onclick = () => editTitle(title, t);

    const meta = document.createElement('div');
    meta.className = 'task-meta';
    const bits = [];
    if (t.due) bits.push(`<span class="when">${t.due === todayStr() ? '오늘' : t.due}</span>`);
    else bits.push('<span class="when muted">날짜 없음</span>');
    bits.push(`<span class="list">${t.listTitle}</span>`);
    if (t.repeat) {
      bits.push(`<span class="rep${t.repeat.mode === 'after' ? ' after' : ''}">${t.repeat.mode === 'after' ? '완료기준' : '반복'} ${t.repeat.interval}</span>`);
    }
    if (!t.managed) bits.push('<span class="native">native</span>');
    meta.innerHTML = bits.join('');

    // "Add time" — Tasks API는 시각을 못 담으므로 nzassist가 직접 붙인다
    const timeBtn = document.createElement('button');
    timeBtn.className = `time-btn${t.at ? ' has-time' : ''}`;
    timeBtn.textContent = t.at ? `${t.meta?.gcal ? '🔔 ' : ''}${t.at}` : '＋ 시간';
    timeBtn.title = t.at
      ? (t.meta?.gcal ? '알람이 걸려 있습니다. 눌러서 변경' : '시각만 설정됨 (알람 없음)')
      : '시각을 넣으면 캘린더 알람이 걸립니다';
    timeBtn.onclick = () => toggleEditor(row, t);
    meta.append(timeBtn);

    main.append(title, meta);
    if (t.notes) {
      const note = document.createElement('div');
      note.className = 'task-note';
      note.textContent = t.notes;
      main.append(note);
    }

    row.append(check, main);
    box.append(row);
  });

  const focused = box.querySelector('.is-focused');
  const cur = box.querySelector('.is-cursor');
  if (focused) focused.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (cur && state.mode === 'nav') cur.scrollIntoView({ block: 'nearest' });
}

function renderLists() {
  const box = $('lists');
  box.innerHTML = '';
  const mk = (label, id) => {
    const b = document.createElement('button');
    b.className = `list-chip${state.listId === id ? ' is-active' : ''}`;
    b.textContent = label;
    b.onclick = () => { state.listId = id; renderLists(); render(); };
    return b;
  };
  box.append(mk('전체 리스트', null));
  for (const l of state.lists) box.append(mk(l.title, l.id));
}

// ---------------------------------------------------------------- 동작
async function load() {
  try {
    setStatus('불러오는 중…');
    await refreshAuth();
    if (!auth.authenticated && !cfg.apiToken) {
      setStatus('Google 로그인 필요');
      $('empty').classList.remove('hidden');
      $('empty').textContent = 'Google 로그인 후 할 일을 불러옵니다.';
      return;
    }
    const [lists, tasks] = await Promise.all([api('/lists'), api('/tasks')]);
    state.lists = lists;
    state.tasks = tasks;
    const deepLinkId = decodeURIComponent(location.pathname.match(/^\/t\/([^/]+)\/?$/)?.[1] ?? '');
    const deepLinkList = new URLSearchParams(location.search).get('list');
    const focused = deepLinkId && tasks.find(t => t.id === deepLinkId && (!deepLinkList || t.listId === deepLinkList));
    if (focused) {
      state.focusedKey = keyOf(focused);
      state.filter = 'all';
      state.listId = focused.listId;
      state.cursor = 0;
      pickedFilter = true;
      document.querySelectorAll('.filter').forEach(b => b.classList.toggle('is-active', b.dataset.filter === 'all'));
    }
    // 추천에 쓸 태그는 메타와 제목 양쪽에서 모은다 (native task도 잡히도록)
    state.tags = new Set();
    for (const t of tasks) {
      for (const tag of (t.meta?.tags ?? '').split(',')) if (tag) state.tags.add(tag);
      for (const [, tag] of (t.title ?? '').matchAll(/(?:^|\s)#([^\s@#]+)/g)) state.tags.add(tag);
    }
    // 첫 화면이 비어 보이지 않게: 오늘 할 일이 없으면 밀린 항목 → 전체 순으로 넘어간다
    if (!pickedFilter && !tasks.some(FILTERS.today)) {
      state.filter = tasks.some(FILTERS.overdue) ? 'overdue' : 'all';
      for (const b of document.querySelectorAll('.filter')) {
        b.classList.toggle('is-active', b.dataset.filter === state.filter);
      }
    }
    renderLists();
    render();
    setStatus(focused ? `집중 보기 · ${focused.title}` : `${tasks.length}건 · 리스트 ${lists.length}개`);
  } catch (e) {
    setStatus(e.message, false);
  }
}

// ---------------------------------------------------------------- 추천 목록
//
// 커서 바로 앞에서 입력 중인 @ · # 토큰을 잡아 추천한다. 입력창(할일 추가)과
// 검색창 양쪽에서 같은 로직을 쓴다. @를 두 번 쓰면 "지금 입력 중인 뒤엣것"이
// 대상이다 — 자동감지가 우선권을 갖는다.

const TOKEN_RE = /(^|\s)([@#])([^\s@#]*)$/;

function tokenAtCursor(input) {
  const m = TOKEN_RE.exec(input.value.slice(0, input.selectionStart ?? input.value.length));
  return m ? { sigil: m[2], query: m[3], start: (input.selectionStart ?? 0) - m[3].length - 1 } : null;
}

function candidates(sigil, query) {
  const pool = sigil === '@'
    ? state.lists.map(l => ({ value: l.title, kind: '리스트' }))
    : [...state.tags].map(t => ({ value: t, kind: '태그' }));
  const q = query.toLowerCase();
  const hits = pool.filter(c => c.value.toLowerCase().includes(q)).slice(0, 8);
  // 기존에 없는 이름을 치고 있으면 "새로 만들기"를 후보로 보여준다
  if (query && !pool.some(c => c.value.toLowerCase() === q)) {
    hits.push({ value: query, kind: sigil === '@' ? '새 리스트' : '새 태그', isNew: true });
  }
  return hits;
}

/** input 요소 하나와 그 옆 추천 박스를 묶어 컨트롤러를 만든다. */
function createSuggestController(input, box, { onAccept } = {}) {
  const sug = { items: [], index: 0, token: null };

  function close() {
    sug.items = [];
    sug.token = null;
    box.classList.add('hidden');
  }

  function paint() {
    if (!sug.items.length) return close();
    box.innerHTML = '';
    sug.items.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = `suggest-item${i === sug.index ? ' is-active' : ''}${c.isNew ? ' is-new' : ''}`;
      row.innerHTML = `<span>${sug.token.sigil}${c.value}</span><span class="kind">${c.kind}</span>`;
      row.onmousedown = e => { e.preventDefault(); accept(c); };
      box.append(row);
    });
    box.classList.remove('hidden');
  }

  function accept(c) {
    const { start } = sug.token;
    const before = input.value.slice(0, start);
    const after = input.value.slice(input.selectionStart ?? input.value.length);
    const inserted = `${sug.token.sigil}${c.value} `;
    input.value = before + inserted + after;
    const pos = before.length + inserted.length;
    input.setSelectionRange(pos, pos);
    close();
    input.dispatchEvent(new Event('input'));
    onAccept?.();
  }

  function update() {
    const token = tokenAtCursor(input);
    if (!token) return close();
    sug.token = token;
    sug.items = candidates(token.sigil, token.query);
    sug.index = 0;
    paint();
  }

  function handleKeydown(e) {
    if (!sug.items.length) {
      if (e.key === 'Escape') input.blur(); // esc = 목록 선택 모드로
      return false;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sug.index = (sug.index + (e.key === 'ArrowDown' ? 1 : -1) + sug.items.length) % sug.items.length;
      paint();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      accept(sug.items[sug.index]);
    } else if (e.key === 'Escape') {
      close();
    }
    return true; // 이 키를 추천 목록이 소비했다
  }

  return { update, close, handleKeydown, hasItems: () => sug.items.length > 0 };
}

/** 시각 편집기. Tasks API가 시각을 못 담으므로 at= 메타 + 동반 이벤트로 처리한다. */
function toggleEditor(row, t) {
  const open = row.querySelector('.editor');
  if (open) return open.remove();

  const box = document.createElement('div');
  box.className = 'editor';

  const date = Object.assign(document.createElement('input'), { type: 'date', value: t.due ?? '' });
  const time = Object.assign(document.createElement('input'), { type: 'time', value: t.at ?? '09:00' });

  const dur = document.createElement('select');
  for (const [v, label] of [['15m', '15분'], ['30m', '30분'], ['1h', '1시간'], ['2h', '2시간']]) {
    dur.append(Object.assign(document.createElement('option'), {
      value: v, textContent: label, selected: (t.meta?.dur ?? '30m') === v
    }));
  }

  const save = Object.assign(document.createElement('button'), { className: 'primary sm', textContent: '저장' });
  save.onclick = async () => {
    await patch(t, { due: date.value || null, at: time.value, dur: dur.value });
  };

  const clear = Object.assign(document.createElement('button'), { className: 'ghost sm', textContent: '시간 없애기' });
  clear.onclick = async () => { await patch(t, { at: '' }); };

  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = '시각을 넣으면 캘린더에 알람이 걸립니다';

  box.append(date, time, dur, save, clear, hint);
  row.append(box);
  time.focus();
}

/**
 * 제목 클릭 = 편집. 별도 폼을 두지 않고 입력 기반으로 간다.
 * 저장하면 서버가 다시 파싱하므로 `@리스트`, `19:00`, `every! 2 weeks` 를 그대로 쓸 수 있다.
 */
function editTitle(titleEl, t) {
  const original = [...titleEl.childNodes]; // star 아이콘 포함, 취소 시 그대로 복원
  const input = document.createElement('input');
  input.className = 'title-edit';
  input.value = [t.title, t.context ? `@${t.context}` : '', t.at ?? ''].filter(Boolean).join(' ');

  const close = () => titleEl.replaceChildren(...original);
  input.onkeydown = async e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || text === t.title) return close();
      await patch(t, { text });
    }
  };
  input.onblur = close;

  titleEl.replaceChildren(input);
  input.focus();
  input.setSelectionRange(0, t.title.length);
}

async function patch(t, changes) {
  try {
    setStatus('저장 중…');
    const r = await api(`/tasks/${t.listId}/${t.id}`, { method: 'PATCH', body: JSON.stringify(changes) });
    await load();
    setStatus(r.companionError ? `저장됨 · 알람 실패: ${r.companionError}` : (r.at ? `${r.at} 알람 설정됨` : '시간 없앰'), !r.companionError);
  } catch (e) {
    setStatus(e.message, false);
  }
}

async function complete(t) {
  try {
    setStatus('완료 처리 중…');
    const r = await api(`/tasks/${t.listId}/${t.id}/complete`, { method: 'POST' });
    pushUndo(`"${t.title}" 완료`, () => api(`/tasks/${t.listId}/${t.id}/uncomplete`, { method: 'POST' }));
    await load();
    setStatus(r.next ? `완료. 다음 회차 ${r.next.due} 생성됨` : '완료');
  } catch (e) {
    setStatus(e.message, false);
  }
}

/** star 토글. 다건 선택이면 전부 같은 방향으로 켠다. */
async function toggleStar(targets) {
  const turningOn = targets.some(t => !t.starred);
  try {
    await Promise.all(targets.map(t => api(`/tasks/${t.listId}/${t.id}/star`, { method: 'POST', body: JSON.stringify({ on: turningOn }) })));
    pushUndo(`star ${turningOn ? '켬' : '끔'} (${targets.length}건)`,
      () => Promise.all(targets.map(t => api(`/tasks/${t.listId}/${t.id}/star`, { method: 'POST', body: JSON.stringify({ on: !turningOn }) }))));
    await load();
    setStatus(`star ${turningOn ? '켬' : '끔'} · ${targets.length}건`);
  } catch (e) {
    setStatus(e.message, false);
  }
}

async function postponeTasks(targets, spec) {
  const before = targets.map(t => ({ listId: t.listId, id: t.id, due: t.due }));
  try {
    await Promise.all(targets.map(t => api(`/tasks/${t.listId}/${t.id}/postpone`, { method: 'POST', body: JSON.stringify({ spec }) })));
    pushUndo(`postpone ${spec} (${targets.length}건)`, () =>
      Promise.all(before.map(b => api(`/tasks/${b.listId}/${b.id}`, { method: 'PATCH', body: JSON.stringify({ due: b.due }) }))));
    await load();
    setStatus(`${spec} 만큼 미룸 · ${targets.length}건`);
  } catch (e) {
    setStatus(e.message, false);
  }
}

/** 삭제. 되돌리기는 재생성이라 완벽히 같지 않음을 안내한다. */
async function deleteTasks(targets, { force = false } = {}) {
  if (!force && !confirm(`${targets.length}건을 삭제할까요?`)) return;
  const snapshot = targets.map(t => ({ ...t }));
  try {
    await Promise.all(targets.map(t => api(`/tasks/${t.listId}/${t.id}`, { method: 'DELETE' })));
    pushUndo(`삭제 (${targets.length}건, 재생성으로 되돌림)`, () =>
      Promise.all(snapshot.map(t => api('/tasks', {
        method: 'POST',
        body: JSON.stringify({ text: `${t.title}${t.due ? ` ${t.due}${t.at ? ' ' + t.at : ''}` : ''}`, list: t.listId })
      }))));
    state.selected.clear();
    await load();
    setStatus(`삭제됨 · ${targets.length}건`);
  } catch (e) {
    setStatus(e.message, false);
  }
}

const captureSuggest = createSuggestController($('input'), $('suggest'));

// 입력하는 동안 파싱 결과를 미리 보여준다 (저장 전에 확인)
let previewTimer;
$('input').addEventListener('keydown', e => { captureSuggest.handleKeydown(e); });
$('input').addEventListener('blur', () => {
  setTimeout(() => captureSuggest.close(), 120);
  $('capture-wrap').classList.remove('is-focused');
  state.mode = 'nav';
});
$('input').addEventListener('focus', () => {
  $('capture-wrap').classList.add('is-focused');
  state.mode = 'input';
});

$('input').addEventListener('input', e => {
  clearTimeout(previewTimer);
  captureSuggest.update();
  const text = e.target.value.trim();
  if (!text) return $('preview').classList.add('hidden');
  previewTimer = setTimeout(async () => {
    try {
      const p = await api('/preview', { method: 'POST', body: JSON.stringify({ text }) });
      $('pv-title').textContent = p.title || '(제목 없음)';
      const chips = [];
      chips.push(`<span class="chip when">${p.scheduledAt.slice(0, 10)} ${p.scheduledAt.slice(11, 16)}</span>`);
      if (p.context) chips.push(`<span class="chip ctx">@${p.context}</span>`);
      for (const tag of p.tags ?? []) chips.push(`<span class="chip tag">#${tag}</span>`);
      if (p.repeat) chips.push(`<span class="chip rep">${p.repeat.mode === 'after' ? '완료기준' : '반복'} ${p.repeat.interval}</span>`);
      $('pv-chips').innerHTML = chips.join('');
      $('pv-warn').textContent = (p.warnings ?? []).join(' / ');
      $('preview').classList.remove('hidden');
    } catch { /* 미리보기는 실패해도 조용히 넘어간다 */ }
  }, 180);
});

$('capture').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('input').value.trim();
  if (!text) return;
  try {
    setStatus('저장 중…');
    await api('/tasks', { method: 'POST', body: JSON.stringify({ text }) });
    $('input').value = '';
    $('preview').classList.add('hidden');
    await load();
  } catch (err) {
    setStatus(err.message, false);
  }
});

for (const b of document.querySelectorAll('.filter')) {
  b.onclick = () => {
    pickedFilter = true;
    state.filter = b.dataset.filter;
    for (const o of document.querySelectorAll('.filter')) o.classList.toggle('is-active', o === b);
    render();
  };
}

// ---------------------------------------------------------------- 통합 검색 (JQL 풍)
//
// #tag @context 는 탭 필터와 AND로 결합되고, updated/created 비교와 and/or/() 도 된다.
// 문법 오류는 조용히 무시한다 — 타이핑 중간 상태는 항상 불완전한 질의이기 때문이다.

const searchSuggest = createSuggestController($('search'), $('search-suggest'), {
  onAccept: () => $('search').dispatchEvent(new Event('input'))
});

function closeSearch({ clear = false } = {}) {
  if (clear) {
    $('search').value = '';
    state.query = null;
    render();
  }
  searchSuggest.close();
  $('search-wrap').classList.remove('is-open', 'is-focused');
  $('search').blur();
  state.mode = 'nav';
}

function openSearch() {
  $('search-wrap').classList.add('is-open');
  $('search').focus();
}

$('search-toggle').addEventListener('click', openSearch);
$('search-clear').addEventListener('click', () => closeSearch({ clear: true }));
$('search-close').addEventListener('click', () => closeSearch());

$('search').addEventListener('keydown', e => { searchSuggest.handleKeydown(e); });
$('search').addEventListener('blur', () => {
  setTimeout(() => searchSuggest.close(), 120);
  $('search-wrap').classList.remove('is-focused');
  state.mode = 'nav';
});
$('search').addEventListener('focus', () => {
  $('search-wrap').classList.add('is-focused');
  state.mode = 'search';
});
$('search').addEventListener('input', e => {
  searchSuggest.update();
  try {
    state.query = parseQuery(e.target.value);
    $('search-wrap').classList.remove('is-error');
  } catch {
    $('search-wrap').classList.add('is-error'); // 괄호가 안 닫힌 채로 타이핑 중일 수 있다
    return; // 마지막으로 유효했던 질의를 유지한다
  }
  render();
});

$('login').addEventListener('click', () => {
  window.location.assign(`${API_ORIGIN}/auth/google/start`);
});

$('logout').addEventListener('click', async () => {
  await fetch(`${API_ORIGIN}/auth/logout`, { method: 'POST', credentials: 'include' });
  auth.authenticated = false;
  auth.user = null;
  await load();
});

// ---------------------------------------------------------------- 단축키 (vi 차용)
//
// j/k 이동, s/S/d/D star·하위·삭제, p postpone, u undo, / c 입력 포커스,
// f incremental search, ? 도움말, : 명령 팔레트, r 새로고침, Ctrl+클릭 다건 선택.
// 입력창이나 편집기 등 텍스트 필드에 포커스가 있을 때는 전부 무시한다 — 타이핑을 방해하면 안 된다.

const isTyping = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

function focusCapture() { $('input').focus(); }
function focusSearch() { openSearch(); }

function moveCursor(delta) {
  if (!state.shown.length) return;
  state.cursor = Math.max(0, Math.min(state.shown.length - 1, state.cursor + delta));
  render();
}

function currentTask() { return state.shown[state.cursor]; }

function openOverlay(html) {
  const box = $('overlay');
  box.innerHTML = `<div class="overlay-box">${html}</div>`;
  box.classList.remove('hidden');
  box.onclick = e => { if (e.target === box) closeOverlay(); };
  return box;
}
function closeOverlay() { $('overlay').classList.add('hidden'); $('overlay').innerHTML = ''; }

function askPostpone(targets) {
  if (!targets.length) return;
  const box = openOverlay(`
    <h3>postpone — ${targets.length}건</h3>
    <input id="postpone-input" placeholder="1h  2d  3w  1mo" autocomplete="off" />
    <p class="hint">시간 단위: h(시간) d(일) w(주) mo(개월). Enter로 적용, Esc로 취소</p>
  `);
  const input = box.querySelector('#postpone-input');
  input.focus();
  input.onkeydown = async e => {
    if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const spec = input.value.trim();
      if (!/^\d+(h|d|w|mo)$/.test(spec)) return setStatus('형식: 1h 2d 3w 1mo', false);
      closeOverlay();
      await postponeTasks(targets, spec);
    }
  };
}

function openPalette() {
  const box = openOverlay(`
    <h3>명령 팔레트</h3>
    <input id="palette-input" placeholder="delete list <이름>   ·   undo   ·   refresh" autocomplete="off" />
    <p class="hint">Enter로 실행, Esc로 취소</p>
  `);
  const input = box.querySelector('#palette-input');
  input.focus();
  input.onkeydown = async e => {
    if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = input.value.trim();
      closeOverlay();
      await runCommand(cmd);
    }
  };
}

async function runCommand(cmd) {
  const [head, ...rest] = cmd.split(/\s+/);
  try {
    if (head === 'undo') return undo();
    if (head === 'refresh' || head === 'r') return load();
    if (head === 'delete' && rest[0] === 'list') {
      const name = rest.slice(1).join(' ');
      if (!confirm(`리스트 "${name}" 을(를) 완전히 삭제할까요? task도 전부 사라집니다.`)) return;
      const r = await api(`/lists/${encodeURIComponent(name)}`, { method: 'DELETE' });
      await load();
      return setStatus(`리스트 삭제됨: ${r.deleted}`);
    }
    setStatus(`알 수 없는 명령: ${cmd}`, false);
  } catch (e) {
    setStatus(e.message, false);
  }
}

function toggleHelp() {
  if (!$('overlay').classList.contains('hidden') && $('overlay').dataset.kind === 'help') return closeOverlay();
  const rows = [
    ['j / k', '목록 이동'], ['Ctrl+클릭', '다건 선택'], ['s', 'star 토글'],
    ['S', '하위 task 추가'], ['e / i', '편집 모드'], ['d', '삭제 (확인)'], ['D', '강제 삭제'],
    ['p', 'postpone'], ['u', 'undo'], ['c', '입력창(할일 추가) 포커스'], ['/', '검색창 포커스'],
    ['f', 'incremental search'], ['r', '새로고침'], [':', '명령 팔레트'],
    ['Esc', '선택 해제 / 목록 모드'], ['?', '이 도움말']
  ];
  const box = openOverlay(`
    <h3>단축키</h3>
    <div class="help-grid">${rows.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join('')}</div>
  `);
  box.dataset.kind = 'help';
}

// f — 눈에 보이는 task로 빠르게 이동하는 incremental search. Esc로 중지.
function startIncrementalSearch() {
  state.isearch = '';
  state.mode = 'isearch';
  const box = openOverlay(`<input id="isearch-input" placeholder="입력하는 대로 좁혀집니다…" autocomplete="off" />`);
  box.dataset.kind = 'isearch';
  const input = box.querySelector('#isearch-input');
  input.focus();
  input.oninput = () => { state.isearch = input.value; state.cursor = 0; render(); };
  input.onkeydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); stopIncrementalSearch(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); }
    if (e.key === 'Enter') { e.preventDefault(); stopIncrementalSearch(); }
  };
}
function stopIncrementalSearch() {
  state.isearch = null;
  state.mode = 'nav';
  closeOverlay();
  render();
}

async function addSubtaskPrompt(parent) {
  const box = openOverlay(`
    <h3>"${parent.title}" 의 하위 task</h3>
    <input id="subtask-input" placeholder="세부 항목을 입력…" autocomplete="off" />
    <p class="hint">Enter로 추가, Esc로 취소</p>
  `);
  const input = box.querySelector('#subtask-input');
  input.focus();
  input.onkeydown = async e => {
    if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.value.trim();
      closeOverlay();
      if (!text) return;
      try {
        await api(`/tasks/${parent.listId}/${parent.id}/subtask`, { method: 'POST', body: JSON.stringify({ text }) });
        await load();
        setStatus('하위 task 추가됨');
      } catch (err) {
        setStatus(err.message, false);
      }
    }
  };
}

document.addEventListener('keydown', e => {
  if (state.mode === 'isearch' || isTyping()) return;

  const t = currentTask();
  switch (e.key) {
    case 'j': e.preventDefault(); moveCursor(1); return;
    case 'k': e.preventDefault(); moveCursor(-1); return;
    case 'c': e.preventDefault(); focusCapture(); return;
    case '/': e.preventDefault(); focusSearch(); return;
    case 'f': e.preventDefault(); startIncrementalSearch(); return;
    case 'r': e.preventDefault(); load(); return;
    case '?': e.preventDefault(); toggleHelp(); return;
    case ':': e.preventDefault(); openPalette(); return;
    case 'u': e.preventDefault(); undo(); return;
    case 's': if (t) { e.preventDefault(); toggleStar(selectedTasks()); } return;
    case 'S': if (t) { e.preventDefault(); addSubtaskPrompt(t); } return;
    case 'd': if (t) { e.preventDefault(); deleteTasks(selectedTasks()); } return;
    case 'D': if (t) { e.preventDefault(); deleteTasks(selectedTasks(), { force: true }); } return;
    case 'p': if (t) { e.preventDefault(); askPostpone(selectedTasks()); } return;
    case 'e': case 'i':
      if (t) {
        e.preventDefault();
        const el = document.querySelector(`[data-key="${CSS.escape(keyOf(t))}"] .task-title`);
        if (el) editTitle(el, t);
      }
      return;
    case 'Escape':
      if (state.selected.size) { e.preventDefault(); state.selected.clear(); render(); }
      return;
  }
});

load();
