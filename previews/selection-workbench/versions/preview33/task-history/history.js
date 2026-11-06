/* TH01: synthetic presentation candidate. No production transport or writer. */
(function (global) {
  'use strict';
  const STATES = { completed: '已完成', cancelled: '已取消', scheduled: '待處理', needs_review: '待覆核' };
  const ACTIONS = { create: '新增事項', reschedule: '改期／轉派', complete: '完成事項', cancel: '取消事項', resolve: '核對完成或取消' };
  const PEOPLE = [{ userId: 'synthetic-person-1', name: '照顧者甲（合成）' }, { userId: 'synthetic-person-2', name: '照顧者乙（合成）' }];
  const copy = x => JSON.parse(JSON.stringify(x));
  function freeze(x) { if (x && typeof x === 'object') { Object.freeze(x); Object.values(x).forEach(freeze); } return x; }
  function ended(t) { return t && ['completed', 'cancelled'].includes(t.occurrence.state); }
  function makeTask(n, childId, state, title, unknownDate) {
    const at = '2026-11-04T10:30:00+08:00';
    return { id: 'synthetic-' + n, childId, version: 3, title, details: n === 1 ? '示例安排：整理週末閱讀角。備註中的 <img src=x onerror=alert(1)> 只是合成文字，不會執行。' : '這是一項合成示例，不含真實家庭資料。', kind: n === 2 ? 'appointment' : 'ordinary', assigneeUserId: 'synthetic-person-1', createdBy: 'synthetic-person-1', createdAt: '2026-10-30T09:00:00+08:00', updatedAt: at,
      ...(state === 'completed' && !unknownDate ? { completedAt: at } : {}), ...(state === 'cancelled' && !unknownDate ? { terminalAt: at } : {}),
      occurrence: { id: 'occurrence-' + n, dueAt: '2026-11-02T08:00:00+08:00', timeZone: 'Asia/Hong_Kong', state, terminalBasisVersion: ended({ occurrence: { state } }) ? 2 : null } };
  }
  function fixture(childId) {
    const prefix = childId === 'child-a' ? '' : '另一個合成範圍 · ';
    return [makeTask(1, childId, 'completed', prefix + '整理閱讀角'), makeTask(2, childId, 'cancelled', prefix + '週末故事活動'), makeTask(3, childId, 'completed', prefix + '收好畫畫用品', true), makeTask(4, childId, 'cancelled', prefix + '公園散步', true), makeTask(5, childId, 'completed', prefix + '更換書袋'), makeTask(6, childId, 'scheduled', '未完成的積木整理'), makeTask(7, 'not-current-child', 'completed', '另一位孩子的任務')];
  }
  function revisions(task) {
    const current = { task: copy(task), action: task.occurrence.state === 'cancelled' ? 'cancel' : 'complete', actorUserId: 'synthetic-person-2', basisVersion: 2, note: task.occurrence.state === 'cancelled' ? '示例：安排取消，不表示已完成。' : '示例：已整理好閱讀位置。', at: '2026-11-04T10:30:00+08:00' };
    const earlier = copy(task); earlier.version = 2; earlier.occurrence.state = 'scheduled'; earlier.occurrence.terminalBasisVersion = null; delete earlier.completedAt; delete earlier.terminalAt; earlier.updatedAt = '2026-11-01T09:00:00+08:00';
    const first = copy(earlier); first.version = 1; first.assigneeUserId = 'no-longer-listed'; first.updatedAt = first.createdAt; first.occurrence.dueAt = '2026-11-01T08:00:00+08:00';
    return [current, { task: earlier, action: 'reschedule', actorUserId: 'synthetic-person-1', basisVersion: 1, note: '示例：另選較方便的時段。', at: earlier.updatedAt }, { task: first, action: 'create', actorUserId: 'no-longer-listed', basisVersion: 0, note: '', at: first.createdAt }];
  }
  function person(id) { return PEOPLE.find(x => x.userId === id)?.name || '原負責人待核對'; }
  function time(raw, zone = 'Asia/Hong_Kong') {
    if (!raw || !Number.isFinite(Date.parse(raw))) return '時間待核對';
    try { return new Intl.DateTimeFormat('zh-HK', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(raw)) + ' · ' + zone; } catch (_) { return '時間待核對'; }
  }
  function terminalTime(task) {
    const complete = task.occurrence.state === 'completed'; const raw = complete ? task.completedAt : task.terminalAt;
    return raw && Number.isFinite(Date.parse(raw)) ? time(raw) + (complete ? ' 完成' : ' 取消') : (complete ? '完成時間未提供' : '取消時間未提供');
  }
  function createOwner(options = {}) {
    let state = { epoch: 1, childId: 'child-a', layout: options.layout === 'ledger' ? 'ledger' : 'dossier', page: 1, access: 'read_only', online: true, operation: 'none', dirty: false, readState: 'ready', items: fixture('child-a'), hasMoreTasks: true, selectedId: null, targetId: null, detailRead: null, historyOpen: false, histories: {}, pending: null, revision: 0, notice: '', failNext: false };
    const listeners = new Set(), timers = new Set(); let ticketId = 0, disposed = false;
    const snapshot = () => freeze(copy(state));
    const occupied = () => state.dirty || ['saving', 'unknown', 'conflict'].includes(state.operation);
    const live = () => !disposed && state.access !== 'lost';
    const selected = () => state.items.find(t => t.id === state.selectedId && t.childId === state.childId && ended(t));
    const locked = () => !live() || occupied() || !!state.pending;
    function emit() { if (disposed) return; const rev = ++state.revision, s = snapshot(); for (const fn of [...listeners]) { if (disposed || state.revision !== rev) break; if (listeners.has(fn)) fn(s); } }
    function cancelRead() { state.pending = null; }
    function currentHistory() { const t = selected(); return t && state.histories[t.id]?.version === t.version ? state.histories[t.id] : null; }
    function issue(kind, before = null) {
      if (locked() || !state.online) return false;
      const t = selected(); if (kind === 'history' && !t) return false;
      const ticket = { id: ++ticketId, epoch: state.epoch, childId: state.childId, kind, taskId: kind === 'history' ? t.id : kind === 'detail' ? state.targetId : null, version: t?.version ?? null, before };
      state.pending = ticket;
      if (kind === 'history') { const prev = currentHistory(); state.historyOpen = true; state.histories[t.id] = { version: t.version, items: prev?.items || [], cursor: prev?.cursor ?? null, state: 'loading', retryBefore: before, message: '' }; }
      if (kind === 'detail') state.detailRead = { id: state.targetId, state: 'loading' };
      const error = state.failNext; state.failNext = false; emit();
      if (options.autoRead !== false) { const id = global.setTimeout(() => { timers.delete(id); settle(ticket, error ? 'error' : 'success'); }, 260); timers.add(id); }
      return ticket;
    }
    function settle(ticket, outcome, suppliedPage) {
      const p = state.pending;
      if (!live() || !p || !ticket || !['success', 'error'].includes(outcome) || ['id', 'epoch', 'childId', 'kind', 'taskId', 'version', 'before'].some(k => ticket[k] !== p[k]) || p.epoch !== state.epoch || p.childId !== state.childId) return false;
      if (p.kind === 'history' && (selected()?.id !== p.taskId || selected()?.version !== p.version)) return false;
      state.pending = null;
      if (p.kind === 'history') {
        const h = state.histories[p.taskId];
        const all = revisions(selected());
        const page = suppliedPage === undefined ? { revisions: p.before === null ? all.slice(0, 2) : all.slice(2), nextBeforeVersion: p.before === null ? 2 : null } : suppliedPage;
        const validTime = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
        const positive = v => Number.isInteger(v) && v > 0 && v <= 2147483647;
        const valid = page && Array.isArray(page.revisions) && (page.nextBeforeVersion === null || positive(page.nextBeforeVersion)) && page.revisions.every(r => {
          const t = r?.task, o = t?.occurrence;
          return t && t.id === p.taskId && t.childId === p.childId && positive(t.version) && typeof t.title === 'string' && typeof t.details === 'string'
            && ['ordinary', 'appointment'].includes(t.kind) && typeof t.assigneeUserId === 'string' && typeof t.createdBy === 'string' && validTime(t.createdAt) && validTime(t.updatedAt)
            && o && typeof o.id === 'string' && !!o.id && validTime(o.dueAt) && typeof o.timeZone === 'string' && Object.hasOwn(STATES, o.state) && (o.terminalBasisVersion === null || positive(o.terminalBasisVersion))
            && Object.hasOwn(ACTIONS, r.action) && typeof r.actorUserId === 'string' && r.actorUserId.length > 0 && r.actorUserId.length <= 128
            && Number.isInteger(r.basisVersion) && r.basisVersion >= 0 && r.basisVersion <= 2147483646 && typeof r.note === 'string' && r.note.length <= 1000 && validTime(r.at);
        });
        if (!valid) outcome = 'error';
        if (outcome === 'error') { h.state = 'error'; h.retryBefore = p.before; h.message = p.before === null ? '任務歷史尚未讀取；完成時間不會以安排時間代替。' : '較早的安排記錄未能讀取；已載入的版本仍保留。'; }
        else { const next = copy(page.revisions); h.items = p.before === null ? next : [...h.items, ...next.filter(r => !h.items.some(old => old.task.version === r.task.version))]; h.cursor = page.nextBeforeVersion;
          const task = selected(); const terminal = h.items.find(r => r.task.id === task.id && r.task.childId === task.childId && r.task.version === task.version && r.task.occurrence.id === task.occurrence.id && r.task.occurrence.state === task.occurrence.state && (r.action === 'resolve' || r.action === (task.occurrence.state === 'completed' ? 'complete' : 'cancel')) && Number.isFinite(Date.parse(r.at)));
          if (terminal) { if (task.occurrence.state === 'completed') task.completedAt = terminal.at; task.terminalAt = terminal.at; }
          h.state = 'ready'; h.retryBefore = null; h.message = ''; }
      } else if (p.kind === 'detail') {
        // The missing-target demo has no remote substitute. A successful read can still be unavailable.
        state.detailRead = { id: p.taskId, state: 'error' }; state.selectedId = null;
      } else if (outcome === 'error') { state.readState = state.items.length ? 'stale' : 'error'; }
      else if (p.kind === 'more') { state.items.push(makeTask(8, state.childId, 'completed', '整理玩具收納盒'), makeTask(9, state.childId, 'cancelled', '借閱繪本活動')); state.hasMoreTasks = false; state.readState = 'ready'; }
      else { state.readState = 'ready'; }
      emit(); return true;
    }
    function select(id) {
      if (locked()) return false;
      const t = state.items.find(x => x.id === id && x.childId === state.childId && ended(x));
      state.targetId = id; state.historyOpen = false;
      if (!t) { state.selectedId = null; state.detailRead = { id, state: 'error' }; emit(); return false; }
      // A retained ready receipt is not a current selection. Each admitted row open selects again.
      state.selectedId = t.id; state.detailRead = { id: t.id, state: 'ready' }; state.notice = ''; emit(); return true;
    }
    function close() {
      if (!live() || occupied()) return false;
      cancelRead(); state.selectedId = null; state.targetId = null; state.historyOpen = false; emit(); return true;
    }
    function toggleHistory() {
      if (!live() || occupied() || state.pending || !selected()) return false;
      if (state.historyOpen) { state.historyOpen = false; emit(); return true; }
      state.historyOpen = true;
      if (!state.online) { state.notice = '目前離線，只顯示已載入的記錄。'; emit(); return true; }
      return issue('history');
    }
    function scenario(name) {
      if (disposed) return false;
      if (name === 'access-lost' || name === 'other-child' || name === 'first-child') {
        state.epoch++; cancelRead(); state.selectedId = null; state.targetId = null; state.detailRead = null; state.historyOpen = false; state.histories = {}; state.dirty = false; state.operation = 'none'; state.page = 1; state.notice = '';
        state.childId = name === 'other-child' ? 'child-b' : 'child-a'; state.access = name === 'access-lost' ? 'lost' : 'read_only'; state.items = name === 'access-lost' ? [] : fixture(state.childId); state.hasMoreTasks = name !== 'access-lost'; state.readState = 'ready'; state.online = true;
      } else if (name === 'fail-next') { state.failNext = true; state.notice = '下一次合成讀取將失敗，可操作重試。'; }
      else if (name === 'missing-target') return select('missing-record');
      else if (name === 'stale') state.readState = 'stale';
      else if (['normal', 'read-only', 'offline', 'dirty', 'saving', 'unknown', 'conflict'].includes(name)) {
        state.online = name !== 'offline'; state.dirty = name === 'dirty'; state.operation = ['saving', 'unknown', 'conflict'].includes(name) ? name : 'none'; state.notice = ''; if (name === 'read-only') state.access = 'read_only';
      } else return false;
      emit(); return true;
    }
    return { snapshot, select, close, settle, toggleHistory, scenario,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      moreHistory() { const h = currentHistory(); return h?.state === 'ready' && h.cursor !== null ? issue('history', h.cursor) : false; },
      retryHistory() { const h = currentHistory(); return h?.state === 'error' ? issue('history', h.retryBefore) : false; },
      retryDetail() { return state.detailRead?.state === 'error' && state.targetId ? issue('detail') : false; },
      requestList(kind = 'reload') { return ['reload', 'more'].includes(kind) && (kind !== 'more' || state.hasMoreTasks) ? issue(kind) : false; },
      setLayout(layout) { if (locked() || !['ledger', 'dossier'].includes(layout)) return false; state.layout = layout; emit(); return true; },
      setPage(page) { if (locked() || state.selectedId || !Number.isInteger(page)) return false; const max = Math.max(1, Math.ceil(state.items.filter(t => t.childId === state.childId && ended(t)).length / 4)); state.page = Math.min(max, Math.max(1, page)); emit(); return true; },
      dispose() { if (disposed) return; disposed = true; state.epoch++; cancelRead(); state.items = []; state.histories = {}; state.selectedId = null; listeners.clear(); timers.forEach(t => global.clearTimeout(t)); timers.clear(); }
    };
  }
  function mount(root, owner) {
    const doc = root.ownerDocument; let disposed = false, structuralKey = '', reader = null, origin = null, current = owner.snapshot(), closingReader = false;
    const make = (tag, attrs = {}, text) => { const el = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v !== null && v !== undefined) el.setAttribute(k, String(v)); } if (text !== undefined) el.textContent = text; return el; };
    const add = (p, tag, attrs, text) => { const e = make(tag, attrs, text); p.append(e); return e; };
    const button = (p, label, attrs, fn) => { const b = add(p, 'button', { type: 'button', ...attrs }, label); b.addEventListener('click', () => { if (disposed || !b.isConnected || !root.contains(b) || b.disabled || b.getAttribute('aria-disabled') === 'true') return; fn(); }); return b; };
    const block = s => s.dirty || ['saving', 'unknown', 'conflict'].includes(s.operation);
    const busy = s => block(s) || !!s.pending || s.access === 'lost';
    const disabled = (b, yes) => { b.disabled = !!yes; };
    root.replaceChildren(); root.className = 'th-app';
    const chrome = add(root, 'div', { class: 'chrome' });
    const top = add(chrome, 'header', { class: 'hero' });
    add(top, 'p', { class: 'eyebrow' }, '育伴港 · 選配工作台 / TH01');
    const title = add(top, 'h1', {}, '把結束的事，好好留下');
    add(top, 'p', { class: 'intro' }, '讀一項已完成或已取消的安排，查看當時的快照與原因。這裡沒有重開或重做操作。');
    const modes = add(top, 'div', { class: 'modes', 'aria-label': '閱讀方式' });
    const a = button(modes, 'A 任務檔案', { 'data-layout': 'dossier' }, () => owner.setLayout('dossier'));
    const b = button(modes, 'B 結束流水帳', { 'data-layout': 'ledger' }, () => owner.setLayout('ledger'));
    const provenance = add(top, 'p', { class: 'provenance' });
    const announcement = add(root, 'p', { class: 'status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const area = add(root, 'div', { class: 'content' });
    const foot = add(chrome, 'footer', { class: 'foot' }, '全部為合成資料 · 只顯示已載窗口 · 不代表完整操作稽核或正式產品驗收');
    const panel = add(chrome, 'details', { class: 'scenarios' }); add(panel, 'summary', {}, '合成情境工具');
    const scenarioButtons = add(panel, 'div', { class: 'scenario-buttons' });
    for (const [name, label] of [['normal', '一般閱讀'], ['offline', '離線'], ['read-only', '唯讀'], ['fail-next', '下次讀取失敗'], ['stale', '清單非最新'], ['dirty', '原 owner 有草稿'], ['unknown', '原操作結果未知'], ['access-lost', '權限失效'], ['other-child', '另一合成孩子'], ['first-child', '重建第一範圍'], ['missing-target', '無法找到的指定記錄']]) button(scenarioButtons, label, { 'data-scenario': name }, () => owner.scenario(name));
    function guardedFocus(el) { if (!disposed && el?.isConnected) el.focus({ preventScroll: true }); }
    function doClose() { const active = doc.activeElement; const shouldReturn = !!reader && reader.contains(active); const target = origin, epoch = current.epoch, revision = current.revision; closingReader = true; let accepted; try { accepted = owner.close(); } finally { closingReader = false; } if (!accepted) return; const after = owner.snapshot(); if (after.epoch !== epoch || after.selectedId || after.targetId || after.revision !== revision + 1) return; if (shouldReturn || active === doc.body) guardedFocus(target && area.querySelector(`[data-open="${target}"]`) || area.querySelector('[data-index-heading]')); }
    function meta(parent, pairs) { const dl = add(parent, 'dl', { class: 'metadata' }); for (const [k, v] of pairs) { const div = add(dl, 'div', {}); add(div, 'dt', {}, k); add(div, 'dd', {}, v); } }
    function snapshotBlock(parent, task, historic = false) {
      add(parent, 'p', { class: 'badge ' + task.occurrence.state }, STATES[task.occurrence.state]);
      if (historic) add(parent, 'h4', {}, task.title);
      add(parent, 'p', { class: 'details-copy' }, task.details || '沒有詳細內容');
      meta(parent, [['負責人', person(task.assigneeUserId)], [task.kind === 'appointment' ? '預約時間' : '預定完成', time(task.occurrence.dueAt, task.occurrence.timeZone)], ['加入時間', time(task.createdAt, task.occurrence.timeZone)], ['最後更新', time(task.updatedAt, task.occurrence.timeZone)]]);
      if (!PEOPLE.some(p => p.userId === task.assigneeUserId)) add(parent, 'p', { class: 'warning' }, '這是歷史指派，不代表現時有權執行或可聯絡。');
    }
    function index(s) {
      const section = add(area, 'section', { 'data-index': '', class: s.layout === 'ledger' ? 'ledger-index' : 'dossier-index' });
      const head = add(section, 'div', { class: 'index-heading' });
      add(head, 'h2', { tabindex: '-1', 'data-index-heading': '' }, s.layout === 'ledger' ? '結束流水帳' : '任務檔案櫃');
      if (s.access === 'lost') { add(section, 'p', { class: 'warning' }, '孩子權限已失效，事項及歷史已清除。'); return; }
      const tasks = s.items.filter(t => t.childId === s.childId && ended(t));
      add(head, 'p', { class: 'meta' }, `已載入 ${tasks.length} 項完成／取消記錄${s.hasMoreTasks ? '；仍有事項未載入。' : '。'} 不包括待處理或待覆核事項。`);
      if (s.readState === 'stale' || !s.online) { add(section, 'p', { class: 'warning' }, !s.online ? '目前離線，已載入內容可能不是最新。' : '未能更新，現正顯示上次讀取的事項。'); const reload = button(section, '重新讀取事項', { 'data-reload': '' }, () => owner.requestList('reload')); disabled(reload, busy(s) || !s.online); }
      const visible = s.layout === 'ledger' ? tasks : tasks.slice((s.page - 1) * 4, s.page * 4);
      const list = add(section, 'ol', { class: s.layout === 'ledger' ? 'ledger-list' : 'dossier-grid', role: 'list' });
      for (const task of visible) {
        const li = add(list, 'li', { class: 'record ' + task.occurrence.state });
        const row = button(li, '', { 'data-open': task.id, class: 'record-open', 'aria-label': `${task.title}，${STATES[task.occurrence.state]}，查看詳情` }, () => { origin = task.id; owner.select(task.id); }); row.setAttribute('aria-disabled', String(busy(s)));
        add(row, 'span', { class: 'record-code', 'aria-hidden': 'true' }, 'FILE / ' + task.id.split('-').at(-1).padStart(2, '0'));
        add(row, 'span', { class: 'record-title' }, task.title); add(row, 'span', { class: 'badge ' + task.occurrence.state }, STATES[task.occurrence.state]);
        add(row, 'span', { class: 'terminal-time' }, terminalTime(task)); add(row, 'span', { class: 'meta' }, `目前版本 ${task.version} · ${person(task.assigneeUserId)}`);
        add(row, 'span', { class: 'read-affordance' }, '讀取檔案 ↗');
      }
      const nav = add(section, 'nav', { class: 'pager', 'aria-label': '已載入事項分頁' });
      if (s.layout === 'dossier') { const max = Math.max(1, Math.ceil(tasks.length / 4)); const prev = button(nav, '上一頁', { 'data-prev-page': '' }, () => owner.setPage(s.page - 1)); disabled(prev, busy(s) || s.page <= 1); add(nav, 'span', {}, `第 ${s.page} / ${max} 頁 · 每頁最多 4 項`); const next = button(nav, '下一頁', { 'data-next-page': '' }, () => owner.setPage(s.page + 1)); disabled(next, busy(s) || s.page >= max); }
      if (s.hasMoreTasks) { const more = button(nav, s.pending?.kind === 'more' ? '正在載入事項…' : '載入更多事項', { 'data-more-tasks': '' }, () => owner.requestList('more')); disabled(more, busy(s) || !s.online); }
    }
    function createReader(s) {
      const t = s.items.find(x => x.id === s.selectedId); if (!t) return;
      const wrap = add(area, 'div', { class: s.layout === 'ledger' ? 'modal-backdrop' : 'dossier-page' });
      reader = add(wrap, 'section', { 'data-reader': t.id, ...(s.layout === 'ledger' ? { role: 'dialog', 'aria-modal': 'true' } : { 'data-dossier-reader': '' }), 'aria-labelledby': 'reader-title', class: 'reader' });
      const toolbar = add(reader, 'div', { class: 'reader-toolbar' });
      button(toolbar, s.layout === 'ledger' ? '關閉詳情' : '返回任務檔案', { 'data-close': '', class: 'quiet' }, doClose);
      button(toolbar, s.layout === 'ledger' ? '切換至檔案頁' : '切換至流水帳彈窗', { 'data-switch-layout': '', class: 'quiet' }, () => owner.setLayout(s.layout === 'ledger' ? 'dossier' : 'ledger'));
      add(reader, 'p', { class: 'eyebrow' }, '已結束事項 / ' + t.id.toUpperCase());
      add(reader, 'h2', { id: 'reader-title', tabindex: '-1' }, t.title);
      const result = add(reader, 'section', { class: 'result-card', 'aria-labelledby': 'result-heading' }); add(result, 'h3', { id: 'result-heading' }, '處理結果'); add(result, 'strong', {}, STATES[t.occurrence.state]); add(result, 'p', { 'data-result-time': '' }, terminalTime(t)); add(result, 'p', {}, '提醒已停止。這項事項已結束，不能直接重開；如需另做，請明確新增另一項事項。');
      const currentBox = add(reader, 'section', { class: 'current-snapshot', 'aria-labelledby': 'snapshot-heading' }); add(currentBox, 'h3', { id: 'snapshot-heading' }, '目前安排 · 版本 ' + t.version); snapshotBlock(currentBox, t);
      add(currentBox, 'p', { class: 'meta' }, '未提供這個版本的背景處理紀錄。站內已處理不代表外部通知送達、已讀或照護完成。');
      const disclosure = button(reader, '查看安排記錄', { 'data-history-toggle': '', 'aria-expanded': 'false', 'aria-controls': 'revision-region' }, () => owner.toggleHistory());
      const history = add(reader, 'section', { id: 'revision-region', hidden: '', class: 'history-region' });
      add(history, 'h3', { id: 'history-heading', tabindex: '-1' }, '每版快照、操作人、基準及原因');
      add(history, 'p', { class: 'meta' }, '以下是目前已載入的安排版本，不是完整稽核紀錄。日期屬於各版記錄；不以預定時間補作完成時間。');
      add(history, 'div', { 'data-history-feedback': '', role: 'status', 'aria-live': 'polite' });
      add(history, 'ol', { class: 'revision-list', role: 'list', 'data-revisions': '' });
      const actions = add(history, 'div', { class: 'history-actions' });
      button(actions, '重試讀取安排記錄', { 'data-history-retry': '', hidden: '' }, () => owner.retryHistory());
      button(actions, '載入較早記錄', { 'data-older-control': '', hidden: '' }, () => owner.moreHistory());
      const lock = add(reader, 'div', { class: 'reader-lock', 'data-reader-lock': '' });
      add(lock, 'p', {}, '示例原 owner 保留草稿或結果未知，請回原處理流程核對。本候選不能替它重試或清稿。');
      button(lock, '示例工具：回復一般閱讀狀態', { 'data-scenario-normal': '' }, () => owner.scenario('normal'));
      const demo = add(reader, 'details', { class: 'reader-scenarios' }); add(demo, 'summary', {}, '此檔案的合成情境');
      for (const [name, label] of [['fail-next', '下次記錄讀取失敗'], ['unknown', '模擬原操作結果未知'], ['dirty', '模擬原 owner 草稿'], ['offline', '模擬離線'], ['normal', '回復一般閱讀']]) button(demo, label, { 'data-reader-scenario': name }, () => owner.scenario(name));
      if (s.layout === 'ledger') { const idx = area.querySelector('[data-index]'); idx?.setAttribute('inert', ''); idx?.setAttribute('aria-hidden', 'true'); chrome.setAttribute('inert', ''); chrome.setAttribute('aria-hidden', 'true'); }
      updateReader(s); guardedFocus(reader.querySelector('#reader-title'));
    }
    function updateReader(s) {
      if (!reader) return; const t = s.items.find(x => x.id === s.selectedId); if (!t) return;
      const activeReader = reader, priorFocus = doc.activeElement;
      reader.querySelector('[data-result-time]').textContent = terminalTime(t);
      const h = s.histories[t.id]; const toggle = reader.querySelector('[data-history-toggle]');
      toggle.textContent = s.historyOpen ? '收起安排記錄' : '查看安排記錄'; toggle.setAttribute('aria-expanded', String(s.historyOpen));
      // Preserve focused read control while busy, while still rejecting activation.
      toggle.setAttribute('aria-disabled', String(busy(s)));
      reader.querySelector('[data-close]').disabled = block(s); reader.querySelector('[data-switch-layout]').disabled = busy(s);
      reader.querySelector('[data-reader-lock]').hidden = !block(s);
      const region = reader.querySelector('#revision-region');
      const collapsedFocus = !region.hidden && !s.historyOpen && region.contains(priorFocus); region.hidden = !s.historyOpen;
      if (s.historyOpen) region.setAttribute('data-history', ''); else region.removeAttribute('data-history');
      const feedback = reader.querySelector('[data-history-feedback]'); feedback.replaceChildren();
      if (s.historyOpen) {
        if (h?.state === 'loading') add(feedback, 'p', {}, h.retryBefore === null ? '正在讀取安排記錄…' : '正在讀取較早記錄，已載入版本仍保留…');
        else if (h?.state === 'error') add(feedback, 'p', { 'data-history-error': '', class: 'warning' }, h.message);
        else if (!h) add(feedback, 'p', {}, !s.online ? '目前離線，尚未讀取安排記錄。' : '尚未讀取安排記錄。');
        else if (h.state === 'ready' && h.cursor === null) add(feedback, 'p', { 'data-history-complete': '' }, '已展示目前已載入的全部版本；不表示已知所有操作。');
      }
      const list = reader.querySelector('[data-revisions]');
      // Initial pages may replace any accepted revision field, not only version/time.
      const versionKey = JSON.stringify(h?.items || []);
      if (list.dataset.versions !== versionKey) { list.dataset.versions = versionKey; list.replaceChildren(); for (const r of h?.items || []) { const li = add(list, 'li', { 'data-revision': r.task.version, class: 'revision' }); add(li, 'h4', {}, `版本 ${r.task.version} · ${ACTIONS[r.action]}`); add(li, 'p', { class: 'meta' }, `操作人：${person(r.actorUserId)}；原基準版本 ${r.basisVersion}`); add(li, 'p', { class: 'meta' }, '記錄時間：' + time(r.at, r.task.occurrence.timeZone)); snapshotBlock(li, r.task, true); add(li, 'p', { class: 'revision-note' }, '原因／備註：' + (r.note || '沒有備註')); } }
      const retry = reader.querySelector('[data-history-retry]'), older = reader.querySelector('[data-older-control]');
      const focusWasOlder = priorFocus === older, focusWasRetry = priorFocus === retry;
      retry.hidden = h?.state !== 'error'; retry.setAttribute('aria-disabled', String(busy(s) || !s.online));
      older.hidden = !h || h.cursor === null || h.state === 'error'; older.setAttribute('aria-disabled', String(busy(s) || !s.online));
      // Hidden controls are omitted from public discovery; actual buttons remain to preserve identity during busy reads.
      if (older.hidden) older.removeAttribute('data-older'); else older.setAttribute('data-older', '');
      const hiddenControlFocus = s.historyOpen && ((focusWasOlder && older.hidden) || (focusWasRetry && retry.hidden));
      // A collapsed subtree retires to its visible disclosure; newer focus/view wins.
      if ((collapsedFocus || hiddenControlFocus) && reader === activeReader && current.revision === s.revision && (doc.activeElement === priorFocus || doc.activeElement === doc.body)) guardedFocus(collapsedFocus ? toggle : activeReader.querySelector('#history-heading'));
    }
    function render(s) {
      if (disposed) return;
      const previous = current, priorFocus = doc.activeElement, retiredFocus = area.contains(priorFocus);
      const anchor = ['data-open', 'data-index-heading', 'data-more-tasks', 'data-prev-page', 'data-next-page', 'data-reload', 'data-detail-retry'].find(key => priorFocus?.hasAttribute?.(key));
      current = s; root.dataset.layout = s.layout;
      a.setAttribute('aria-pressed', String(s.layout === 'dossier')); b.setAttribute('aria-pressed', String(s.layout === 'ledger')); disabled(a, busy(s)); disabled(b, busy(s));
      provenance.textContent = s.layout === 'dossier' ? 'A：根據 Care 的分頁索引與獨立閱讀頁重新呈現，並採 Harbour 的歷史讀取狀態。' : 'B：根據 Handbook 的清單與可重複開啟詳情彈窗重新呈現，並採 Harbour 的歷史讀取狀態。';
      announcement.textContent = s.access === 'lost' ? '孩子權限已失效；內容已清除。' : block(s) ? (s.dirty ? '原 owner 有草稿；歷史切換與讀取暫停。' : `原操作${s.operation === 'unknown' ? '結果未知' : s.operation === 'saving' ? '正在提交' : '出現衝突'}；不會自動重做。`) : s.notice || (s.pending ? '正在進行合成讀取…' : (s.online ? '唯讀合成示例 · 不會傳送資料或發送通知' : '目前離線 · 只可閱讀已載內容'));
      const key = JSON.stringify([s.epoch, s.layout, s.selectedId, !s.selectedId && s.targetId, !s.selectedId && [s.page, s.items.length, s.readState, s.online, busy(s), s.detailRead?.state]]);
      if (key !== structuralKey) {
        structuralKey = key; reader = null; chrome.removeAttribute('inert'); chrome.removeAttribute('aria-hidden'); area.replaceChildren();
        if (!s.selectedId || s.layout === 'ledger') index(s);
        if (s.selectedId) createReader(s);
        else if (s.targetId) { const error = add(area, 'section', { 'data-detail-error': '', class: 'warning' }); add(error, 'h2', {}, '目前未能查看指定事項'); add(error, 'p', {}, '沒有顯示另一項內容；指定記錄可能尚未載入或不能存取。'); const retry = button(error, '重新讀取此事項', { 'data-detail-retry': '' }, () => owner.retryDetail()); disabled(retry, busy(s) || !s.online); button(error, '返回事項清單', { 'data-close': '' }, doClose); }
      } else updateReader(s);
      // After the complete projection, preserve only an unchanged-context reading anchor.
      // A retired identity falls back to a non-action heading, not another child's same-ID row.
      if (!s.selectedId && retiredFocus && !closingReader && current.revision === s.revision && (doc.activeElement === doc.body || doc.activeElement === priorFocus)) {
        const sameContext = previous.epoch === s.epoch && previous.layout === s.layout;
        const selector = sameContext && anchor ? '[' + anchor + (anchor === 'data-open' ? '="' + priorFocus.getAttribute(anchor) + '"' : '') + ']' : null;
        const restored = selector && area.querySelector(selector);
        guardedFocus(restored && !restored.disabled && !restored.hidden ? restored : area.querySelector('[data-index-heading]'));
      }
    }
    function keys(event) {
      if (!reader || current.layout !== 'ledger') return;
      if (event.key === 'Escape') { event.preventDefault(); doClose(); return; }
      if (event.key !== 'Tab') return;
      const items = [...reader.querySelectorAll('button, summary, [tabindex="0"]')].filter(e => !e.disabled && !e.hidden && !e.closest('[hidden]') && !(e.closest('details:not([open])') && e.tagName !== 'SUMMARY'));
      if (!items.length) { event.preventDefault(); guardedFocus(reader.querySelector('#reader-title')); return; }
      const first = items[0], last = items.at(-1), active = doc.activeElement;
      if (event.shiftKey && (active === first || !items.includes(active))) { event.preventDefault(); guardedFocus(last); }
      else if (!event.shiftKey && (active === last || !items.includes(active))) { event.preventDefault(); guardedFocus(first); }
    }
    const unsub = owner.subscribe(render); doc.addEventListener('keydown', keys); render(current);
    return { dispose() { if (disposed) return; disposed = true; unsub(); doc.removeEventListener('keydown', keys); root.replaceChildren(); } };
  }
  global.TaskHistory = Object.freeze({ createOwner, mount });
  const app = global.document?.querySelector('[data-th-autostart]');
  if (app) { let owner = null, view = null; const start = () => { owner = createOwner(); view = mount(app, owner); }; start(); global.addEventListener('pagehide', () => { view?.dispose(); owner?.dispose(); view = null; owner = null; }); global.addEventListener('pageshow', () => { if (!owner) start(); }); }
})(window);
