const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Production JSX and request lifetimes with hook, form and presentation ports.
// No browser, live API, model or device is exercised by this bounded harness.
const cardId = '00000000-0000-4000-8000-000000000001';
const card = { cardId, revision: 1, name: '個人公告', kind: 'bulletin', url: 'https://school.example/news/', frequencyMinutes: 60,
  enabled: true, credentialRef: null, lastCheckedAt: null, nextCheckAt: null, lastResult: null, checking: false };
function compile(file, load, timer = { setTimeout, clearTimeout }) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'production', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', js)(load, module, module.exports, timer.setTimeout, timer.clearTimeout);
  return module.exports;
}
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function setup(params = {}) {
  const slots = [], effects = [], calls = [], forms = [], pendingFlags = new Map();
  let cursor = 0, tree, response = () => Response.json({ items: [card], nextCursor: null });
  const slot = create => { const i = cursor++; if (!(i in slots)) slots[i] = create(); return slots[i]; };
  const react = { useRef: value => slot(() => ({ current: value })), useState: initial => {
    const state = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
    return [state.value, value => { state.value = typeof value === 'function' ? value(state.value) : value; }];
  }, useMemo: make => make(), useCallback: callback => callback, useId: () => slot(() => `source-test-${cursor}`), useEffect: (effect, deps) => {
    const state = slot(() => ({ deps: undefined, cleanup: undefined }));
    if (!state.deps || !deps || deps.some((value, i) => value !== state.deps[i])) { state.deps = deps; effects.push(() => { state.cleanup?.(); state.cleanup = effect(); }); }
  } };
  const snapshot = { identityKey: 'account-a', sessionGeneration: 1 };
  const production = { identityKey: snapshot.identityKey, sessionGeneration: 1, userId: 'actor', auth: 'signedIn', account: { gate: 'ready' } };
  const owner = { fetcher: async (url, init) => { calls.push({ url: String(url), init }); return response(url, init); },
    getSnapshot: () => snapshot, setDomainPending: (key, pending) => pendingFlags.set(key, pending) };
  const env = { apiBaseUrl: '/api', owner, userId: 'actor', identityKey: 'account-a', online: true, writeReady: true,
    currentIdentity: () => snapshot.identityKey === env.identityKey, canStartWrite: () => ![...pendingFlags.values()].some(Boolean), accessError() {} };
  const requestTools = compile('SettingsDomainSupport.ts', name => {
    if (name === 'react') return react;
    if (name.endsWith('/online-refresh-events')) return { subscribeOnlineRefresh: () => () => {} };
    throw new Error(name);
  });
  const shared = require('../../src/shared/registered-source-card.ts');
  const api = compile('registered-source-cards-api.ts', name => name.startsWith('../../../src/shared/') ? require(name.slice(3)) : require(name));
  const components = new Proxy({}, { get: (_, key) => key });
  let focusCallback, focusCleanup;
  const loader = name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name === 'react-hook-form') return { Controller: 'Controller', useForm: options => {
      const state = react.useRef(null);
      if (!state.current) { const form = { values: { ...options.defaultValues }, formState: { isDirty: false, errors: {} }, control: {},
        reset(values) { this.values = { ...values }; this.formState.errors = {}; this.formState.isDirty = false; }, watch(key) { return this.values[key]; }, getValues(key) { return this.values[key]; }, setValue(key, value) { this.values[key] = value; },
        setFocus() {}, setError(field, error) { this.formState.errors[field] = error; }, handleSubmit(fn) { return () => fn({ ...this.values }); } };
        state.current = form; forms.push(form); }
      return state.current;
    } };
    if (name === '@hookform/resolvers/zod') return { zodResolver: () => () => {} };
    if (name === 'zod') return require(name);
    if (name.includes('/shared/registered-source-card')) return shared;
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 800, ref: null, onLayout() {} }) };
    if (name === 'expo-router') return { useLocalSearchParams: () => params, useFocusEffect: callback => { focusCallback = callback; react.useEffect(() => { focusCleanup = callback(); return () => focusCleanup?.(); }, []); } };
    if (name.endsWith('/AppDialog')) return { AppDialog: Object.assign('AppDialog', {}) };
    if (name.endsWith('/SourceLibrary') || name.endsWith('/AppRadioItem') || name.endsWith('/FormErrorSummary') || name.endsWith('/ui')) return components;
    if (name.endsWith('/theme')) return { chineseFont: '', colors: {}, readingType: { body: {}, meta: {} }, spacing: {} };
    if (name === './ProductionProvider') return { useProduction: () => production };
    if (name === './useDomainEnvironment') return { useDomainEnvironment: () => env, useDomainWriteGuard: (...args) => {
      assert.equal(args[2], 'account'); assert.equal(args[3], false); const id = react.useId();
      react.useEffect(() => { owner.setDomainPending(id, args[1]); return () => owner.setDomainPending(id, false); }, [args[1]]);
    } };
    if (name === './SettingsDomainSupport') return requestTools;
    if (name === './registered-source-cards-api') return api;
    throw new Error(name);
  };
  const timers = new Map(); let timerId = 0;
  const ui = compile('RegisteredSourceCards.tsx', loader, { setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; }, clearTimeout(id) { timers.delete(id); } });
  // A stable component boundary represents the actual account-keyed child.
  const scoped = ui.RegisteredSourceCards({ active: true });
  let active = true;
  function render() { cursor = 0; tree = scoped.type({ active }); while (effects.length) effects.shift()(); return tree; }
  function nodes(value = tree) { const all = []; function walk(item) { if (!item || typeof item !== 'object') return; if (Array.isArray(item)) { for (const child of item) walk(child); return; } if (item.props) { all.push(item); walk(item.props.children); walk(item.props.action); if (item.props.personal) { walk(item.props.personal.add); walk(item.props.personal.current); walk(item.props.personal.inactive); walk(item.props.personal.status); } } } walk(value); return all; }
  const button = label => { const found = nodes().find(item => ['AppButton','LibraryAction'].includes(item.type) && item.props.label === label); assert.ok(found, `Missing button: ${label}`); return found.props; };
  const flush = async () => { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  render();
  const openCard = () => { const cover = nodes().find(item => item.type === 'LibraryRow' && item.props.label === `開啟來源「${card.name}」`); assert.ok(cover); cover.props.onOpen(); render(); button('管理個人卡').onPress(); render(); };
  return { calls, forms, slots, timers, pendingFlags, params, env, snapshot, production, ui, scoped, render, nodes, button, flush, openCard, respond: fn => { response = fn; }, setActive(value) { active = value; render(); }, refocus() { focusCleanup?.(); focusCleanup = focusCallback(); render(); },
    cleanup() { for (const state of slots) state?.cleanup?.(); }, text: () => JSON.stringify(tree) };
}

test('only a current private gap offers the existing assistant draft and a dismissible request', async () => {
  const s = setup({ sourceCard: cardId });
  const gap = { url: card.url, reason: 'unreadable', skipped: false, checkId: '00000000-0000-4000-8000-000000000005' };
  const blocked = { ...card, lastResult: { status: 'failed' }, gap };
  const drafts = [];
  s.production.actions = { prepareQuestion: text => drafts.push(text) };
  s.env.childId = 'child';
  s.respond(url => Response.json(String(url).endsWith(cardId) ? { card: blocked } : { items: [blocked], nextCursor: null }));
  await s.flush();
  assert.match(s.text(), /未能從這個位置讀到可引用的原文/);
  s.button('在助手對話跟進').onPress(); s.render();
  assert.equal(drafts.length, 1); assert.ok(drafts[0].includes(card.url));
  s.openCard();
  s.respond(() => Response.json({ card: { ...blocked, gap: { ...gap, skipped: true } } }));
  s.button('跳過這次求助').onPress(); await s.flush();
  assert.equal(JSON.parse(s.calls.at(-1).init.body).checkId, gap.checkId);
  assert.doesNotMatch(s.text(), /在助手對話跟進|跳過這次求助/);
  s.cleanup();
});

test('no-child account management creates minute-based source settings through the production transport', async () => {
  const s = setup(); await s.flush();
  assert.ok(s.scoped, 'No selected child is required');
  s.button('新增個人卡').onPress(); s.render();
  Object.assign(s.forms[0].values, { name: '文件目錄', kind: 'directory', url: card.url, frequencyMinutes: '15', allowedPath: '/public/' });
  s.respond(() => Response.json({ card: { ...card, name: '文件目錄', kind: 'directory', allowedPath: '/public/' } }));
  await s.button('保存來源').onPress(); await s.flush();
  const posted = JSON.parse(s.calls.find(call => call.init.method === 'POST').init.body);
  assert.equal(posted.action, 'create'); assert.equal(posted.expectedRevision, 0);
  assert.deepEqual(posted.settings, { name: '文件目錄', kind: 'directory', url: card.url, frequencyMinutes: 15, allowedPath: '/public/' });
  assert.equal(new Headers(s.calls[0].init.headers).get('x-expected-user-id'), 'actor');
  s.cleanup();
});
test('unknown check-now stays locked through readback and retries the original operation only', async () => {
  const s = setup(); await s.flush(); s.openCard(); s.respond(() => new Response(null, { status: 503 }));
  s.button('即時巡查').onPress(); await s.flush();
  const original = s.calls.at(-1).init.body;
  assert.equal(s.button('新增個人卡').disabled, true);
  s.respond(() => Response.json({ card })); s.button('先讀回這張來源卡').onPress(); await s.flush();
  assert.ok(s.button('明確重試原操作')); assert.equal(s.button('新增個人卡').disabled, true);
  s.respond(() => Response.json({ card: { ...card, checking: true } })); s.button('明確重試原操作').onPress(); await s.flush();
  assert.equal(s.calls.at(-1).init.body, original);
  assert.match(s.text(), /巡查已排入/);
  s.cleanup();
});
test('credential secrets clear immediately and unknown retry retains only operation metadata and login URL', async () => {
  const s = setup(); await s.flush(); s.openCard(); s.button('本人登入授權').onPress(); s.render();
  assert.match(s.text(), /school\.example/);
  const field = s.nodes().find(item => item.type === 'Controller' && item.props.name === 'password');
  const rendered = field.props.render({ field: { value: '', onChange() {}, onBlur() {}, ref() {} }, fieldState: {} });
  assert.equal(rendered.props.secureTextEntry, true); assert.equal(rendered.props.autoComplete, 'off');
  Object.assign(s.forms[1].values, { username: 'PRIVATE_ACTOR', password: 'PRIVATE_PASSWORD', loginUrl: 'https://school.example/login' });
  const waiting = deferred(); s.respond(() => waiting.promise); s.button('同意並保存登入授權').onPress(); s.render();
  assert.equal(s.forms[1].values.password, ''); assert.equal(s.forms[1].values.username, '');
  assert.ok(!JSON.stringify(s.slots).includes('PRIVATE_PASSWORD'));
  const original = JSON.parse(s.calls.at(-1).init.body);
  waiting.resolve(new Response(null, { status: 503 })); await s.flush();
  assert.equal(s.forms[1].values.password, ''); assert.ok(!JSON.stringify(s.slots).includes('PRIVATE_PASSWORD'));
  Object.assign(s.forms[1].values, { username: 'PRIVATE_ACTOR', password: 'WRONG_PASSWORD' });
  s.respond(() => Response.json({ error: { code: 'operation_conflict', message: 'PRIVATE_PASSWORD' } }, { status: 409 }));
  s.button('以原操作重試登入授權').onPress(); await s.flush();
  assert.ok(s.button('以原操作重試登入授權')); assert.equal(s.button('新增個人卡').disabled, true);
  Object.assign(s.forms[1].values, { username: 'PRIVATE_ACTOR', password: 'PRIVATE_PASSWORD' });
  s.respond(() => Response.json({ card: { ...card, credentialRef: cardId, revision: 2 } }));
  s.button('以原操作重試登入授權').onPress(); await s.flush();
  assert.deepEqual(JSON.parse(s.calls.at(-1).init.body), original);
  assert.equal(s.forms[1].values.password, ''); s.cleanup();
});
test('authorization deep links open an account card and reject a different login origin', async () => {
  const s = setup({ sourceCard: cardId, sourceAction: 'authorize' });
  s.respond(url => Response.json(String(url).endsWith(cardId) ? { card } : { items: [card], nextCursor: null }));
  await s.flush(); assert.match(s.text(), /本人登入授權/);
  assert.equal(s.forms[1].values.loginUrl, card.url);
  const count = s.calls.length;
  Object.assign(s.forms[1].values, { username: 'PRIVATE_ACTOR', password: 'PRIVATE_PASSWORD', loginUrl: 'https://different.example/login' });
  s.button('同意並保存登入授權').onPress(); s.render();
  assert.equal(s.calls.length, count); assert.match(s.forms[1].formState.errors.loginUrl.message, /同一個 HTTPS origin/);
  const firstKey = s.ui.RegisteredSourceCards({}).key; s.production.sessionGeneration++;
  assert.notEqual(s.ui.RegisteredSourceCards({}).key, firstKey, 'Session change remounts and clears account state');
  s.cleanup();
});
test('queued checking-false cards poll when due without replacing an active credential draft', async () => {
  const s = setup(); await s.flush(); s.openCard();
  s.respond(() => Response.json({ card: { ...card, enabled: false, nextCheckAt: '2026-01-01T00:00:00Z', checking: false } }));
  s.button('即時巡查').onPress(); await s.flush();
  assert.match(s.text(), /巡查已排入/); assert.equal(s.timers.size, 1);
  s.button('本人登入授權').onPress(); s.render();
  Object.assign(s.forms[1].values, { username: 'PRIVATE_ACTOR', password: 'PRIVATE_DRAFT', loginUrl: 'https://school.example/login' });
  const poll = [...s.timers.values()][0]; assert.equal(poll.delay, 5000);
  s.respond(() => Response.json({ card: { ...card, enabled: false, lastCheckedAt: '2026-11-19T00:00:00Z', lastResult: { status: 'unchanged' }, nextCheckAt: null } }));
  poll.callback(); await s.flush();
  assert.equal(s.forms[1].values.password, 'PRIVATE_DRAFT'); assert.equal(s.forms[1].values.loginUrl, 'https://school.example/login');
  assert.match(s.text(), /未有更新/); s.cleanup();
});
test('remove unknown leaves recovery reachable and account cleanup aborts late reads', async () => {
  const s = setup(); await s.flush(); s.openCard();
  s.button('移除來源').onPress(); s.render();
  s.respond(() => new Response(null, { status: 503 })); s.button('確認移除來源').onPress(); await s.flush();
  const modal = s.nodes().find(item => item.props?.visible !== undefined); assert.equal(modal.props.visible, false);
  assert.ok(s.button('明確重試原操作'));
  const waiting = deferred(); s.respond(() => waiting.promise); s.button('先讀回這張來源卡').onPress(); s.render();
  const last = s.calls.at(-1); s.cleanup(); assert.equal(last.init.signal.aborted, true);
  const before = s.text(); waiting.resolve(Response.json({ card: { ...card, name: 'Late account result' } }));
  await new Promise(resolve => setImmediate(resolve)); s.render();
  assert.equal(s.text(), before); assert.ok(!s.text().includes('Late account result'));
});
test('new source defaults follow kind until manual entry, while an existing frequency remains unchanged', async () => {
  const s = setup(); await s.flush(); s.button('新增個人卡').onPress(); s.render();
  assert.equal(s.forms[0].values.frequencyMinutes, '10080');
  const input = name => { const element = s.nodes().find(item => item.type === 'Controller' && item.props.name === name); return element.props.render({ field: { value: s.forms[0].values[name], onChange: value => { s.forms[0].values[name] = value; }, onBlur() {}, ref() {} }, fieldState: {} }); };
  input('kind').props.children.find(row => row.props.value === 'bulletin').props.onPress(); s.render(); assert.equal(s.forms[0].values.frequencyMinutes, '1440');
  input('frequencyMinutes').props.onChangeText('10080'); input('kind').props.children.find(row => row.props.value === 'document').props.onPress(); s.render();
  assert.equal(s.forms[0].values.frequencyMinutes, '10080'); input('kind').props.children.find(row => row.props.value === 'bulletin').props.onPress(); s.render(); assert.equal(s.forms[0].values.frequencyMinutes, '10080');
  s.button('取消修改').onPress(); s.render(); s.openCard(); s.button('修改設定').onPress(); s.render();
  input('kind').props.children.find(row => row.props.value === 'document').props.onPress(); s.render(); assert.equal(s.forms[0].values.frequencyMinutes, '60'); s.cleanup();
});
test('leaving the tab clears unsent secrets and a deleted credential target can release the local pending guard', async () => {
  const s = setup(); await s.flush(); s.openCard(); s.button('本人登入授權').onPress(); s.render();
  Object.assign(s.forms[1].values, { username: 'PRIVATE_ACTOR', password: 'PRIVATE_PASSWORD' }); s.setActive(false);
  assert.equal(s.forms[1].values.password, ''); assert.equal(s.forms[1].values.username, ''); s.setActive(true);
  await s.flush();
  assert.equal(s.button('同意並保存登入授權').disabled, false);
  Object.assign(s.forms[1].values, { username: 'PRIVATE_ACTOR', password: 'PRIVATE_PASSWORD' });
  s.respond(() => new Response(null, { status: 503 })); s.button('同意並保存登入授權').onPress(); await s.flush();
  s.respond(() => Response.json({ error: { code: 'source_card_not_found' } }, { status: 404 })); s.button('先讀回這張來源卡').onPress(); await s.flush();
  assert.ok([...s.pendingFlags.values()].some(Boolean)); s.button('清除本機等待狀態').onPress(); await s.flush();
  assert.ok(![...s.pendingFlags.values()].some(Boolean)); assert.equal(s.button('新增個人卡').disabled, false); s.cleanup();
});
test('the same card can change from a view deep link to an authorization deep link', async () => {
  const s = setup({ sourceCard: cardId });
  s.respond(url => Response.json(String(url).endsWith(cardId) ? { card } : { items: [card], nextCursor: null }));
  await s.flush(); const before = s.calls.length;
  s.params.sourceAction = 'authorize'; s.render(); await s.flush();
  assert.equal(s.calls.length, before + 1); assert.equal(s.forms[1].values.loginUrl, card.url);
  assert.ok(s.button('同意並保存登入授權')); s.cleanup();
});
test('safe tab and navigation returns refresh the account list while dirty drafts and unknown operations are preserved', async () => {
  const s = setup(); await s.flush();
  s.respond(() => Response.json({ items: [{ ...card, name: 'Assistant update' }], nextCursor: null }));
  const first = s.calls.length; s.setActive(false); s.setActive(true); await s.flush();
  assert.equal(s.calls.length, first + 1); assert.match(s.text(), /Assistant update/);
  const second = s.calls.length; s.refocus(); await s.flush(); assert.equal(s.calls.length, second + 1);
  s.button('新增個人卡').onPress(); s.render(); s.forms[0].formState.isDirty = true;
  const dirty = s.calls.length; s.setActive(false); s.setActive(true); s.refocus(); await s.flush(); assert.equal(s.calls.length, dirty);
  s.button('取消修改').onPress(); s.render();
  s.respond(() => Response.json({ items: [card], nextCursor: null })); s.refocus(); await s.flush(); s.openCard();
  s.respond(() => new Response(null, { status: 503 })); s.button('即時巡查').onPress(); await s.flush();
  const unknown = s.calls.length; s.setActive(false); s.setActive(true); s.refocus(); await s.flush(); assert.equal(s.calls.length, unknown);
  assert.ok(s.button('明確重試原操作')); s.cleanup();
});
test('source settings and credential text inputs expose their visible label as the accessible name', async () => {
  const s = setup(); await s.flush(); s.button('新增個人卡').onPress(); s.render(); s.forms[0].values.kind = 'directory'; s.render();
  const assertNamed = names => {
    for (const name of names) {
      const element = s.nodes().find(item => item.type === 'Controller' && item.props.name === name);
      const input = element.props.render({ field: { value: '', onChange() {}, onBlur() {}, ref() {} }, fieldState: {} });
      assert.equal(input.props.accessibilityLabel, input.props.label, name);
    }
  };
  assertNamed(['name', 'url', 'allowedPath', 'frequencyMinutes']);
  s.button('取消修改').onPress(); s.render(); s.openCard(); s.button('本人登入授權').onPress(); s.render();
  assertNamed(['loginUrl', 'username', 'password']); s.cleanup();
});
test('expanded source cards show only acknowledged saved and searchable counts, including zero', async () => {
  const s = setup(); await s.flush(); s.openCard();
  assert.ok(!s.text().includes('已保存 ')); assert.ok(!s.text().includes('可檢索 '));
  s.respond(() => Response.json({ items: [{ ...card, lastResult: { status: 'changed', savedDocumentCount: 0, indexedDocumentCount: 2 } }], nextCursor: null }));
  s.button('重新讀取來源卡').onPress(); await s.flush();
  assert.match(s.text(), /已保存 0 份/); assert.match(s.text(), /可檢索 2 份/);
  s.respond(() => Response.json({ items: [{ ...card, lastResult: { status: 'changed', savedDocumentCount: 1 } }], nextCursor: null }));
  s.button('重新讀取來源卡').onPress(); await s.flush();
  assert.match(s.text(), /已保存 1 份/); assert.ok(!s.text().includes('可檢索 ')); s.cleanup();
});

test('personal cards on later pages appear in the correct list only after a complete read', async () => {
  const s = setup(); await s.flush();
  const later = { ...card, cardId: 'c6842a71-d467-4169-8c2e-f6d4d253f649', name: 'Later disabled card', enabled: false };
  const list = () => s.nodes().find(node => node.type === 'SourceLibrary').props.personal;
  const pages = (url, fail) => String(url).includes('cursor=')
    ? fail ? new Response(null, { status: 503 }) : Response.json({ items: [later], nextCursor: null })
    : Response.json({ items: [card], nextCursor: 'second' });
  s.respond(url => pages(url, true)); s.refocus(); await s.flush();
  assert.equal(list().ready, false); assert.equal(list().inactive.length, 0);
  s.respond(url => pages(url, false)); s.button('重新讀取來源卡').onPress(); await s.flush();
  assert.equal(list().ready, true); assert.equal(list().current.length, 1);
  assert.deepEqual(list().inactive.map(row => row.props.title), [later.name]); s.cleanup();
});
