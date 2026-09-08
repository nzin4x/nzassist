// Google API 클라이언트. 의존성 없이 fetch만 쓴다.
//
// googleapis 패키지는 Lambda 콜드 스타트에 부담이 커서 쓰지 않는다.
// 필요한 건 토큰 갱신과 몇 개의 REST 호출뿐이다.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

export class GoogleApiError extends Error {
  constructor(status, body, url) {
    super(`Google API ${status}: ${body?.error?.message ?? JSON.stringify(body)}`);
    this.name = 'GoogleApiError';
    this.status = status;
    this.body = body;
    this.url = url;
    this.reason = body?.error?.errors?.[0]?.reason;
    // 403 quotaExceeded는 캘린더 연속 생성에서 특히 잘 난다 (D10). 재시도 대상이다.
    // 반면 accessNotConfigured(API 미활성)는 재시도해도 소용없다.
    this.retryable = status === 429 || status >= 500 ||
      (status === 403 && this.reason !== 'accessNotConfigured');
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 토큰 갱신만 담당한다. Calendar / Tasks 클라이언트가 공유한다. */
export function createAuth({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('clientId / clientSecret / refreshToken 이 모두 필요합니다.');
  }

  let accessToken = null;
  let expiresAt = 0;

  return {
    fetchImpl,
    async token() {
      if (accessToken && Date.now() < expiresAt - 60_000) return accessToken;
      const res = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      });
      const body = await res.json();
      if (!res.ok) throw new GoogleApiError(res.status, body, TOKEN_URL);
      accessToken = body.access_token;
      expiresAt = Date.now() + body.expires_in * 1000;
      return accessToken;
    }
  };
}

/** 백오프와 페이지네이션이 붙은 REST 호출기. */
function createApi(auth, base) {
  async function call(path, { method = 'GET', body, retries = 5 } = {}) {
    const url = `${base}${path}`;
    for (let attempt = 0; ; attempt++) {
      const res = await auth.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${await auth.token()}`,
          ...(body ? { 'content-type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });

      if (res.status === 204) return null;
      const payload = await res.json().catch(() => ({}));
      if (res.ok) return payload;

      const err = new GoogleApiError(res.status, payload, url);
      if (!err.retryable || attempt >= retries) throw err;
      // ±25% 지터를 섞어 여러 호출이 같은 순간에 몰리지 않게 한다.
      await sleep(500 * 2 ** attempt * (0.75 + Math.random() * 0.5));
    }
  }

  // privateExtendedProperty 처럼 같은 키가 여러 번 필요한 경우가 있어 직접 조립한다.
  const qs = params => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v === undefined || v === null) continue;
      Array.isArray(v) ? v.forEach(one => q.append(k, one)) : q.append(k, v);
    }
    return q;
  };

  async function pages(path, params, key = 'items') {
    const out = [];
    let pageToken;
    do {
      const q = qs({ ...params, pageToken });
      const page = await call(`${path}${q.toString() ? `?${q}` : ''}`);
      out.push(...(page?.[key] ?? []));
      pageToken = page?.nextPageToken;
      if (page?.nextSyncToken) out.nextSyncToken = page.nextSyncToken;
    } while (pageToken);
    return out;
  }

  return { call, pages, qs };
}

const enc = encodeURIComponent;

export function createCalendarClient(auth) {
  const { call, pages, qs } = createApi(auth, CALENDAR_API);
  return {
    call, pages,
    listCalendars: () => pages('/users/me/calendarList'),
    createCalendar: summary =>
      call('/calendars', { method: 'POST', body: { summary, timeZone: 'Asia/Seoul' } }),
    deleteCalendar: id => call(`/calendars/${enc(id)}`, { method: 'DELETE' }),
    listEvents: (cal, params = {}) => pages(`/calendars/${enc(cal)}/events`, params),
    getEvent: (cal, id) => call(`/calendars/${enc(cal)}/events/${enc(id)}`),
    insertEvent: (cal, event) => call(`/calendars/${enc(cal)}/events`, { method: 'POST', body: event }),
    patchEvent: (cal, id, patch) =>
      call(`/calendars/${enc(cal)}/events/${enc(id)}`, { method: 'PATCH', body: patch }),
    deleteEvent: (cal, id) => call(`/calendars/${enc(cal)}/events/${enc(id)}`, { method: 'DELETE' }),
    // 반복 이벤트의 개별 회차. 회차를 patch하면 예외(exception)가 생긴다 (D11).
    listInstances: (cal, id, params = {}) =>
      pages(`/calendars/${enc(cal)}/events/${enc(id)}/instances`, params)
  };
}

export function createTasksClient(auth) {
  const { call, pages, qs } = createApi(auth, TASKS_API);
  return {
    call, pages,
    listTaskLists: () => pages('/users/@me/lists'),
    createTaskList: title => call('/users/@me/lists', { method: 'POST', body: { title } }),
    deleteTaskList: id => call(`/users/@me/lists/${enc(id)}`, { method: 'DELETE' }),
    listTasks: (list, params = {}) => pages(`/lists/${enc(list)}/tasks`, params),
    getTask: (list, id) => call(`/lists/${enc(list)}/tasks/${enc(id)}`),
    // parent / previous 는 body가 아니라 쿼리 파라미터다.
    insertTask: (list, task, params) =>
      call(`/lists/${enc(list)}/tasks${params ? `?${qs(params)}` : ''}`, { method: 'POST', body: task }),
    patchTask: (list, id, patch) =>
      call(`/lists/${enc(list)}/tasks/${enc(id)}`, { method: 'PATCH', body: patch }),
    deleteTask: (list, id) => call(`/lists/${enc(list)}/tasks/${enc(id)}`, { method: 'DELETE' }),
    // 다른 리스트로 옮기기는 지원되지 않는다. 새로 만들고 지워야 한다.
    moveTask: (list, id, params) => call(`/lists/${enc(list)}/tasks/${enc(id)}/move?${qs(params)}`, { method: 'POST' })
  };
}

export const authFromEnv = (env = process.env) => createAuth({
  clientId: env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN
});

export const clientFromEnv = (env = process.env) => createCalendarClient(authFromEnv(env));
export const tasksFromEnv = (env = process.env) => createTasksClient(authFromEnv(env));
