/** Standalone synthetic projection host. Not SharingController, an API adapter,
 * an authority service, or a proposal to replace production ownership. */
const clone = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const page = () => ({ items: [], nextCursor: null });
const detailEmpty = () => ({ selected: null, selectionId: null, members: page(), shares: page(), teacherClasses: page(), query: '', recordKind: 'members', inspector: null });
const initial = context => ({ ...context, layout: 'atlas', loaded: false, spaces: page(), ...detailEmpty(), busy: false, notice: null });
export const normalizeQuery = value => String(value).slice(0, 160).normalize('NFKC').trim().toLocaleLowerCase('zh-HK').slice(0, 160);
export function formatDate(value) {
  const date = new Date(value);
  if (typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/u.test(value) || !Number.isFinite(date.getTime())) return '日期不可用';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} HKT`;
}
const fail = () => { throw Object.assign(new Error('Invalid synthetic projection'), { code: 'invalid_response' }); };
const idOf = (kind, item) => kind === 'members' ? item.userId : kind === 'shares' ? item.childId : item.id;
const validText = value => typeof value === 'string' && value.length > 0;
const fields = {
  spaces: ['id', 'kind', 'name', 'version', 'role', 'managerUserId', 'transferTargetUserId', 'createdAt', 'updatedAt', 'teacherSpaceId', 'teacherSpaceName', 'teacherSpaceVersion', 'detachTargetUserId'],
  members: ['userId', 'label', 'role', 'version', 'joinedAt'],
  shares: ['childId', 'childName', 'modules', 'sharedBy', 'version', 'canWithdraw'],
};
function cleanItem(raw, kind) {
  const type = kind === 'teacherClasses' ? 'spaces' : kind;
  if (!raw || typeof raw !== 'object' || !validText(idOf(type, raw)) || !Number.isInteger(raw.version) || raw.version < 1) fail();
  if (type !== 'shares' && !['owner', 'caregiver', 'viewer'].includes(raw.role)) fail();
  if (type === 'spaces' && (!['family', 'class', 'teachers'].includes(raw.kind) || !validText(raw.name))) fail();
  if (type === 'members' && !validText(raw.label)) fail();
  if (type === 'shares' && (!validText(raw.childName) || !Array.isArray(raw.modules) || raw.modules.length < 1 || raw.modules.length > 8 || raw.modules.some(x => !['profile', 'care', 'memory', 'tasks', 'documents', 'growth', 'concerns', 'attachments'].includes(x)))) fail();
  return Object.fromEntries(fields[type].filter(k => Object.hasOwn(raw, k)).map(k => [k, clone(raw[k])]));
}
function cleanPage(raw, kind, before = page()) {
  if (!raw || !Array.isArray(raw.items) || raw.items.length > 20 || !(raw.nextCursor === null || validText(raw.nextCursor) && raw.nextCursor.length <= 8192)) fail();
  if (before.nextCursor && raw.nextCursor === before.nextCursor) fail();
  const items = raw.items.map(item => cleanItem(item, kind));
  const ids = new Set(before.items.map(item => idOf(kind, item)));
  for (const item of items) { const id = idOf(kind, item); if (ids.has(id)) fail(); ids.add(id); }
  return { items: [...before.items, ...items], nextCursor: raw.nextCursor };
}
const authorityKey = selected => selected ? JSON.stringify([selected.id, selected.kind, selected.version, selected.role, selected.teacherSpaceId ?? null, selected.teacherSpaceVersion ?? null]) : '';
export function createHost({ transport, context = {} } = {}) {
  if (typeof transport !== 'function') throw new TypeError('A local synthetic transport is required.');
  let state = freeze(initial({ identity: 'synthetic-account-a', session: 1, mode: 'teachers', ready: true, online: true, globalChild: 'synthetic-reading-child', ...context }));
  let generation = 0, active = null, disposed = false;
  const listeners = new Set();
  const binding = () => `${generation}`;
  const update = patch => { state = freeze({ ...state, ...patch }); for (const fn of [...listeners]) fn(state); };
  const valid = b => !disposed && b === binding() && state.ready && !!state.identity;
  const admit = b => valid(b) && state.online && !state.busy;
  const cancel = () => { active?.controller.abort(); active = null; generation++; };
  const inspector = () => {
    const target = state.inspector;
    if (!target || !state.selected || !state.ready) return null;
    const item = state[target.kind].items.find(item => idOf(target.kind, item) === target.id);
    return item ? freeze({ kind: target.kind, item, selected: state.selected, busy: state.busy, stale: !!state.notice || !state.online }) : null;
  };
  function reconcileInspector() {
    if (state.inspector && !inspector()) update({ inspector: null });
  }
  async function read(op, params, apply, b = binding()) {
    if (!admit(b)) return false;
    const request = { generation, controller: new AbortController() };
    active = request;
    update({ busy: true, notice: null });
    const current = () => active === request && generation === request.generation && !request.controller.signal.aborted && !disposed;
    try {
      if (!current()) return false;
      const response = await transport(op, { ...params, mode: state.mode, identity: state.identity, signal: request.controller.signal });
      if (!current()) return false;
      apply(response);
      reconcileInspector();
      return true;
    } catch (error) {
      if (!current()) return false;
      const code = error?.code || 'unavailable';
      if (['invalid_cursor', 'sharing_scope_changed'].includes(code)) {
        generation++; update({ ...detailEmpty(), spaces: page(), loaded: false, notice: { code, kind: 'cleared' } });
      } else if ([401, 403, 404].includes(error?.status)) {
        generation++; update({ ...detailEmpty(), notice: { code: 'access_denied', kind: 'cleared' } });
      } else update({ notice: { code, kind: 'retained' } });
      return false;
    } finally {
      if (active === request) { active = null; update({ busy: false }); }
    }
  }
  const host = {
    getSnapshot: () => state, binding,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setContext(patch) {
      if (disposed) return false;
      const allowed = ['identity', 'session', 'mode', 'ready', 'online', 'globalChild'];
      const next = Object.fromEntries(allowed.filter(k => Object.hasOwn(patch, k)).map(k => [k, patch[k]]));
      if (next.mode && !['teachers', 'class', 'family'].includes(next.mode)) return false;
      const changed = Object.keys(next).filter(k => next[k] !== state[k]);
      if (!changed.length) return false;
      cancel();
      const reset = changed.some(k => ['identity', 'session', 'mode', 'ready'].includes(k));
      if (reset) {
        const ctx = Object.fromEntries(allowed.map(k => [k, Object.hasOwn(next, k) ? next[k] : state[k]]));
        update({ ...initial(ctx), layout: state.layout });
      } else update({ ...next, busy: false, inspector: changed.includes('globalChild') ? null : state.inspector });
      return true;
    },
    setLayout(layout) { if (!['atlas', 'desk'].includes(layout) || disposed) return false; update({ layout }); return true; },
    setQuery(query, b = binding()) { if (!valid(b)) return false; update({ query: String(query).slice(0, 160) }); return true; },
    setRecordKind(kind, b = binding()) {
      if (!valid(b) || !state.selected || !['members', 'shares'].includes(kind) || state.selected.kind === 'teachers' && kind === 'shares') return false;
      update({ recordKind: kind, query: '', inspector: null }); return true;
    },
    visibleRecords() {
      const query = normalizeQuery(state.query), kind = state.recordKind;
      return state[kind].items.filter(item => !query || String(kind === 'members' ? `${item.label} ${item.userId}` : `${item.childName} ${item.childId}`).normalize('NFKC').toLocaleLowerCase('zh-HK').includes(query));
    },
    inspect(kind, id, b = binding()) {
      if (!valid(b) || !state.selected || !['members', 'shares'].includes(kind) || !state[kind].items.some(item => idOf(kind, item) === id)) return false;
      update({ inspector: { kind, id } }); return true;
    },
    closeInspector(b = binding()) { if (!valid(b)) return false; update({ inspector: null }); return true; },
    getInspector: inspector,
    loadSpaces(more = false, b = binding()) {
      if (more && !state.spaces.nextCursor) return Promise.resolve(false);
      const before = more ? state.spaces : page();
      return read('spaces', { cursor: more ? before.nextCursor : null }, raw => {
        const spaces = cleanPage(raw, 'spaces', before);
        if (spaces.items.some(item => item.kind !== state.mode)) fail();
        update({ spaces, loaded: true });
      }, b);
    },
    selectSpace(id, b = binding()) {
      if (!admit(b)) return Promise.resolve(false);
      const target = state.spaces.items.find(s => s.id === id) ?? state.teacherClasses.items.find(s => s.id === id) ?? (state.selected?.id === id ? state.selected : null);
      if (!target || !(target.kind === state.mode || state.mode === 'teachers' && target.kind === 'class' && target.teacherSpaceId)) return Promise.resolve(false);
      const same = state.selected?.id === id;
      let selectionBinding = b;
      if (!same) { generation++; selectionBinding = binding(); update({ ...detailEmpty(), selectionId: id }); }
      return read('detail', { spaceId: id }, raw => {
        const selected = cleanItem(raw.selected, 'spaces');
        if (selected.id !== id || selected.kind !== target.kind || target.teacherSpaceId && selected.teacherSpaceId !== target.teacherSpaceId) fail();
        const members = cleanPage(raw.members, 'members'), shares = cleanPage(raw.shares, 'shares'), teacherClasses = cleanPage(raw.teacherClasses, 'teacherClasses');
        if (selected.kind === 'teachers' && shares.items.length || selected.kind !== 'teachers' && teacherClasses.items.length || teacherClasses.items.some(s => s.kind !== 'class' || s.teacherSpaceId !== selected.id)) fail();
        if (authorityKey(state.selected) !== authorityKey(selected)) generation++;
        update({ selected, selectionId: id, members, shares, teacherClasses, recordKind: same ? state.recordKind : selected.kind === 'teachers' ? 'members' : 'shares' });
      }, selectionBinding);
    },
    refresh(b = binding()) { if (!valid(b)) return Promise.resolve(false); return state.selected ? host.selectSpace(state.selected.id, b) : host.loadSpaces(false, b); },
    loadMore(kind, b = binding()) {
      if (!valid(b) || !state.selected || !['members', 'shares', 'teacherClasses'].includes(kind) || !state[kind].nextCursor) return Promise.resolve(false);
      if (kind === 'teacherClasses' && state.selected.kind !== 'teachers' || kind === 'shares' && state.selected.kind === 'teachers') return Promise.resolve(false);
      const before = state[kind], selected = state.selected;
      return read(kind, { spaceId: selected.id, cursor: before.nextCursor }, raw => {
        const next = cleanPage(raw, kind, before);
        if (kind === 'teacherClasses' && next.items.some(s => s.kind !== 'class' || s.teacherSpaceId !== selected.id)) fail();
        update({ [kind]: next });
      }, b);
    },
    dispose() { cancel(); disposed = true; listeners.clear(); },
  };
  return Object.freeze(host);
}
