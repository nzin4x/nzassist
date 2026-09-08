// JIRA JQL 풍 검색 질의. #tag @context 자유단어를 섞고, updated/created 에 대해
// 상대 기간 비교(`updated < 1d`)를 지원한다. and/or/() 서브쿼리와 not도 된다.
//
//   parse('영수증 #집안일 @회사 and updated < 1d')
//   matches(ast, task)
//
// 연속된 단어 사이에 and/or가 없으면 암묵적으로 AND 로 묶는다 (JQL/구글 검색 관행).

const FIELD_RE = /^(updated|created)$/i;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, mo: 2_629_800_000, y: 31_557_600_000 };

function tokenize(input) {
  const tokens = [];
  const re = /\s*(\(|\)|#[^\s()]+|@[^\s()]+|(?:updated|created)\s*(?:<=|>=|<|>)\s*\d+\s*(?:mo|[mhdwy])|[^\s()]+)/gi;
  let m;
  while ((m = re.exec(input))) {
    const raw = m[1];
    if (raw === '(') tokens.push({ type: 'lparen' });
    else if (raw === ')') tokens.push({ type: 'rparen' });
    else if (/^and$/i.test(raw)) tokens.push({ type: 'and' });
    else if (/^or$/i.test(raw)) tokens.push({ type: 'or' });
    else if (/^not$/i.test(raw)) tokens.push({ type: 'not' });
    else if (raw[0] === '#') tokens.push({ type: 'tag', value: raw.slice(1) });
    else if (raw[0] === '@') tokens.push({ type: 'ctx', value: raw.slice(1) });
    else {
      const cmp = /^(updated|created)\s*(<=|>=|<|>)\s*(\d+)\s*(mo|[mhdwy])$/i.exec(raw);
      tokens.push(cmp
        ? { type: 'cmp', field: cmp[1].toLowerCase(), op: cmp[2], amount: Number(cmp[3]), unit: cmp[4].toLowerCase() }
        : { type: 'word', value: raw });
    }
  }
  return tokens;
}

// 앞 토큰 뒤에 다른 항이 곧장 이어지면 (연산자 없이) 암묵적 AND 를 끼워 넣는다.
function withImplicitAnd(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const prev = out[out.length - 1];
    const cur = tokens[i];
    const prevEndsTerm = prev && !['and', 'or', 'not', 'lparen'].includes(prev.type);
    const curStartsTerm = !['and', 'or', 'rparen'].includes(cur.type);
    if (prevEndsTerm && curStartsTerm) out.push({ type: 'and' });
    out.push(cur);
  }
  return out;
}

class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }
  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }

  parseOr() {
    let node = this.parseAnd();
    while (this.peek()?.type === 'or') { this.next(); node = { op: 'or', left: node, right: this.parseAnd() }; }
    return node;
  }
  parseAnd() {
    let node = this.parseUnary();
    while (this.peek()?.type === 'and') { this.next(); node = { op: 'and', left: node, right: this.parseUnary() }; }
    return node;
  }
  parseUnary() {
    if (this.peek()?.type === 'not') { this.next(); return { op: 'not', node: this.parseUnary() }; }
    return this.parseAtom();
  }
  parseAtom() {
    const t = this.next();
    if (!t) throw new Error('예상치 못한 질의 끝');
    if (t.type === 'lparen') {
      const node = this.parseOr();
      if (this.peek()?.type !== 'rparen') throw new Error("')' 가 필요합니다");
      this.next();
      return node;
    }
    if (t.type === 'tag') return { op: 'tag', value: t.value };
    if (t.type === 'ctx') return { op: 'ctx', value: t.value };
    if (t.type === 'cmp') return { op: 'cmp', field: t.field, cmp: t.op, amount: t.amount, unit: t.unit };
    if (t.type === 'word') return { op: 'word', value: t.value };
    throw new Error(`예상치 못한 토큰: ${t.type}`);
  }
}

/** 질의 문자열을 AST로. 빈 문자열은 null(항상 참)을 준다. */
export function parseQuery(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const tokens = withImplicitAnd(tokenize(text));
  const ast = new Parser(tokens).parseOr();
  return ast;
}

const norm = s => String(s ?? '').toLowerCase();

function cmpAge(task, field, op, amount, unit, now) {
  const iso = field === 'updated' ? task.updatedAt : task.createdAt;
  if (!iso) return false;
  const age = now - new Date(iso).getTime();
  const bound = amount * (UNIT_MS[unit] ?? UNIT_MS.d);
  switch (op) {
    case '<': return age < bound;
    case '<=': return age <= bound;
    case '>': return age > bound;
    case '>=': return age >= bound;
    default: return false;
  }
}

/**
 * @param {object|null} ast   parseQuery() 결과
 * @param {object} task       { title, tags, context, updatedAt, createdAt, ... }
 * @param {number} [now]      테스트 결정성을 위한 주입점
 */
export function matches(ast, task, now = Date.now()) {
  if (!ast) return true;
  switch (ast.op) {
    case 'and': return matches(ast.left, task, now) && matches(ast.right, task, now);
    case 'or': return matches(ast.left, task, now) || matches(ast.right, task, now);
    case 'not': return !matches(ast.node, task, now);
    case 'tag': return (task.tags ?? []).some(t => norm(t) === norm(ast.value));
    case 'ctx': return norm(task.context) === norm(ast.value);
    case 'word': return norm(task.title).includes(norm(ast.value));
    case 'cmp': return cmpAge(task, ast.field, ast.cmp, ast.amount, ast.unit, now);
    default: return true;
  }
}

/** 편의 함수: 문자열을 바로 매칭까지. */
export const search = (query, task, now) => matches(parseQuery(query), task, now);
