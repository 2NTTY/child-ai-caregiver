const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://synthetic.test' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'Event', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.ResizeObserver = window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
global.fetch = () => { throw new Error('Real network is forbidden.'); };
const root = path.resolve(__dirname, '../..'), req = createRequire(path.join(root, 'frontend/package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), RN = req('react-native-web'), ts = req('typescript'), e = React.createElement;
const Production = React.createContext(null), cache = new Map(), Empty = () => null;
const Surface = React.forwardRef(({ children, testID, tabIndex }, ref) => e('div', { ref, tabIndex, 'data-testid': testID }, children));
const Text = ({ children, testID, accessibilityRole, accessibilityLiveRegion }) => e('span', { 'data-testid': testID, role: accessibilityRole === 'alert' ? 'alert' : undefined, 'aria-live': accessibilityLiveRegion }, children);
const Button = React.forwardRef(({ children, onPress, disabled, accessibilityLabel }, ref) => e(RN.Pressable, { ref, onPress, disabled, accessibilityRole: 'button', accessibilityLabel }, e(Text, null, children)));
const Input = React.forwardRef(({ label, disabled, editable, value, onChangeText, maxLength }, ref) => e(RN.TextInput, { ref, accessibilityLabel: label, editable: !disabled && editable, value, onChangeText, maxLength }));
const Dialog = Object.assign(({ visible, children }) => visible ? e('section', { role: 'dialog' }, children) : null, { Title: Text, Content: Surface, Actions: Surface });
const theme = { colors: {}, radius: {}, readingType: {}, workspaceType: {}, mobileType: {}, mobileIcons: {}, mobileLayout: { breakpoint: 600 }, typeScale: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16 } };
// Real screens, owner/API schemas, React and RN Web buttons. Paper/Dialog/timeline
// ports isolate refresh lifecycle, not browser pixels, native gestures or live APIs.
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return RN;
    if (name === 'react-native-paper') return { Text, Button, TextInput: Input, Portal: Surface };
    if (name === 'expo-router') return { usePathname: () => '/chat', useRouter: () => ({ push() {} }) };
    if (name.endsWith('/ProductionProvider')) return { useProduction: () => React.useContext(Production) };
    if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewLeaveGuard() {}, usePreviewNavigation: () => action => action() };
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/useInteractionDensity')) return { useInteractionDensity: () => false };
    if (name.endsWith('/appearance/BackgroundSurface')) return { BackgroundSurface: Surface, useCustomBackground: () => false };
    if (name.endsWith('/AppDialog')) return { AppDialog: Dialog };
    if (name.endsWith('/EmptyListCard')) return { EmptyListCard: ({ title }) => e('div', null, title) };
    if (name.endsWith('/motion')) return { MotionEntrance: Surface };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: Surface };
    if (name.endsWith('/ChatTimeline')) return { ChatTimeline: ({ items, emptyState, header, footer }) => e('section', { 'data-testid': 'timeline' }, header, items.length ? items.map(item => e('p', { key: item.id }, item.text)) : emptyState, footer) };
    if (name.endsWith('/ChatMessage')) return { ChatMessage: Empty, ChatProgressIndicator: () => e('span', { 'data-testid': 'chat-spinner' }, 'spinner') };
    if (name.endsWith('/AgentComposer')) return { AgentComposer: ({ draft, onChangeDraft }) => e('textarea', { 'aria-label': 'Synthetic composer', value: draft, onChange: event => onChangeDraft(event.target.value) }) };
    if (name.endsWith('/locateCitationSource')) return { locateCitationSource() {} };
    if (/\/(AppCheckbox|AppIcon|AppRadioItem|AppStatusBadge|MotionSelectionMarker|HorizontalOverflowRail|OfficialHelpCards|ChatFileMessage|VoiceMessage|AgentConversation)$/.test(name)) return { [name.split('/').pop()]: Empty };
    if (name.endsWith('/PhotoInputDomains')) return { AgentPhotoInput: Empty };
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name), found = [target, target + '.ts', target + '.tsx'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    assert.ok(found, name); return load(path.relative(root, found));
  }, module, module.exports);
  return module.exports;
}
const { AgentAuthorizationOwner } = load('frontend/src/production/AgentAuthorizationOwner.ts');
const { AgentAuthorization } = load('frontend/src/production/AgentAuthorization.tsx');
const ChatPage = load('frontend/src/screens/chatScreen.tsx').default;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const childId = uuid(1), noteId = uuid(2), at = '2026-10-23T00:00:00Z', scope = { key: 'synthetic-scope', userId: 'synthetic-user', childId };
const note = version => ({ id: noteId, childId, version, title: 'Synthetic note', text: `Synthetic body v${version}`, sourceMessageId: uuid(3), provenance: 'user_statement', createdAt: at, updatedAt: at });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const page = items => json({ notes: { items, nextAfterId: null } });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const button = (host, label) => host.querySelector(`[role="button"][aria-label="${label}"]`);
const click = node => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

test('private-note confirmation, search focus and read guards survive ordinary background refresh; changed versions close confirmation', async t => {
  let answer = () => page([note(1)]), writes = 0;
  const owner = new AgentAuthorizationOwner('/api', true, () => {}, () => {}, async (_input, init) => {
    if (init.method !== 'GET') { writes++; throw new Error('No writes allowed'); }
    return answer();
  });
  owner.syncContext(scope, true); await owner.readNotes();
  const container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container);
  t.after(async () => { await React.act(async () => renderer.unmount()); owner.dispose(); container.remove(); });
  const actions = { setQuery: owner.setQuery, readNotes: owner.readNotes, deleteNote: owner.deleteNote };
  function Host() {
    const authorization = React.useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
    return e(Production.Provider, { value: { scopeKey: scope.key, authorization, authorizationActions: actions, owner: { authorizationOwner: owner } } }, e(AgentAuthorization));
  }
  await React.act(async () => renderer.render(e(Host)));
  const input = container.querySelector('input'); await React.act(async () => input.focus()); const first = deferred(); answer = () => first.promise;
  let reading; await React.act(async () => { reading = owner.readNotes(false, true); });
  assert.equal(document.activeElement, input); assert.equal(input.readOnly, true); assert.equal(input.disabled, false);
  await React.act(async () => { first.resolve(page([note(1)])); await reading; });
  assert.equal(document.activeElement, input); assert.equal(input.readOnly, false);
  await React.act(async () => click(button(container, '刪除此私人備註')));
  const dialog = container.querySelector('[role="dialog"]'), confirm = button(container, '確認刪除'); await React.act(async () => confirm.focus());
  const gate = deferred(); answer = () => gate.promise;
  await React.act(async () => { reading = owner.readNotes(false, true); });
  assert.equal(container.querySelector('[role="dialog"]'), dialog); assert.equal(document.activeElement, confirm);
  assert.equal(confirm.getAttribute('aria-disabled'), 'true'); assert.equal(confirm.getAttribute('tabindex'), '-1');
  await React.act(async () => click(confirm)); assert.equal(writes, 0);
  await React.act(async () => { gate.resolve(page([note(1)])); await reading; });
  assert.equal(container.querySelector('[role="dialog"]'), dialog); assert.equal(document.activeElement, confirm);
  assert.notEqual(confirm.getAttribute('aria-disabled'), 'true');
  answer = () => json({ error: { code: 'unavailable' } }, 503);
  await React.act(async () => owner.readNotes(false, true));
  assert.equal(container.querySelector('[role="dialog"]'), dialog); assert.match(container.textContent, /上次讀取/);
  assert.equal(confirm.getAttribute('aria-disabled'), 'true'); await React.act(async () => click(confirm)); assert.equal(writes, 0);
  answer = () => page([note(2)]); await React.act(async () => owner.readNotes());
  assert.equal(container.querySelector('[role="dialog"]'), null); assert.match(container.textContent, /Synthetic body v2/);
  answer = () => page([note(1)]); await React.act(async () => owner.readNotes(false, true));
  assert.equal(container.querySelector('[role="dialog"]'), null, 'expired confirmation cannot reopen when a prior version returns');
  await React.act(async () => click(button(container, '刪除此私人備註'))); assert.ok(container.querySelector('[role="dialog"]'));
  await React.act(async () => owner.syncContext(null, true)); assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.doesNotMatch(container.textContent, /Synthetic body/); assert.equal(writes, 0);
});

test('stale notes retain search focus during retry and shared policy reads announce only a generic refresh', async t => {
  let answer = () => page([note(1)]), writes = 0;
  const owner = new AgentAuthorizationOwner('/api', true, () => {}, () => {}, async (_input, init) => {
    if (init.method !== 'GET') { writes++; throw new Error('No writes allowed'); }
    return answer();
  });
  owner.syncContext(scope, true); await owner.readNotes();
  answer = () => json({ error: { code: 'unavailable' } }, 503); await owner.readNotes(false, true);
  const container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container);
  t.after(async () => { await React.act(async () => renderer.unmount()); owner.dispose(); container.remove(); });
  function Host() {
    const authorization = React.useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
    return e(Production.Provider, { value: { scopeKey: scope.key, authorization, authorizationActions: { setQuery: owner.setQuery, readNotes: owner.readNotes }, owner: { authorizationOwner: owner } } }, e(AgentAuthorization));
  }
  await React.act(async () => renderer.render(e(Host)));
  const input = container.querySelector('input'); await React.act(async () => input.focus());
  const retry = deferred(); answer = () => retry.promise; let reading;
  await React.act(async () => { reading = owner.readNotes(); });
  assert.equal(owner.getSnapshot().notesState, 'failed'); assert.equal(document.activeElement, input);
  assert.equal(input.disabled, false); assert.equal(input.readOnly, true); assert.equal(owner.mayDelete(noteId), false);
  const remove = button(container, '刪除此私人備註'); assert.equal(remove.getAttribute('aria-disabled'), 'true');
  await React.act(async () => click(remove)); assert.equal(container.querySelector('[role="dialog"]'), null); assert.equal(writes, 0);
  assert.match(container.querySelector('[data-testid="status-announcement"]').textContent, /正在重新核對資料/);
  await React.act(async () => { retry.resolve(page([note(1)])); await reading; });
  assert.equal(document.activeElement, input); assert.equal(input.readOnly, false);
  const policy = deferred(); answer = () => policy.promise;
  await React.act(async () => { reading = owner.readPolicy(); });
  assert.equal(owner.getSnapshot().policyState, 'loading'); assert.equal(owner.getSnapshot().notesState, 'ready');
  const announcement = container.querySelector('[data-testid="status-announcement"]').textContent;
  assert.match(announcement, /正在重新核對資料/); assert.doesNotMatch(announcement, /私人備註/);
  assert.equal(document.activeElement, input); assert.equal(owner.mayDelete(noteId), false);
  await React.act(async () => { policy.resolve(json({ error: { code: 'unavailable' } }, 503)); await reading; });
  assert.equal(writes, 0);
});

test('loaded empty and non-empty chat stay mounted without a refresh spinner or operation row; cold/error/scope states remain honest', async t => {
  const state = { userId: scope.userId, selectedChildId: childId, drafts: {}, messages: [], busy: null, online: true,
    loading: false, loadedAt: at, limit: 20, nextCursor: null, loadingOlder: false, error: null };
  const value = { scopeKey: scope.key, model: { selectedChildId: childId, children: [{ id: childId }, { id: uuid(4) }] }, actions: { refresh() {} },
    chatState: state, chatController: { reloadMessages() {} }, chatDraft: 'Synthetic draft', setChatDraft() {}, agentAttachments: [],
    voiceUpload: {}, fileUpload: {}, authorization: {}, chatWritesAllowed: true, agentRuns: {}, agentModel: { readState: 'ready', run: null, pendingDecision: null }, agentPending: { state: 'ready', entries: [] }, readAgentPending() {} };
  const container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container);
  t.after(async () => { await React.act(async () => renderer.unmount()); container.remove(); });
  const render = () => React.act(async () => { renderer.render(e(Production.Provider, { value: { ...value } }, e(ChatPage))); await flush(); });
  await render(); const empty = container.querySelector('[data-testid="chat-empty-prompt"]'), timeline = container.querySelector('[data-testid="timeline"]');
  const composer = container.querySelector('textarea'); composer.focus();
  for (const loading of [true, false, true, false]) {
    state.loading = loading; await render();
    assert.equal(container.querySelector('[data-testid="chat-empty-prompt"]'), empty);
    assert.equal(container.querySelector('[data-testid="timeline"]'), timeline); assert.equal(document.activeElement, composer);
    assert.equal(container.querySelector('[data-testid="chat-spinner"]'), null); assert.equal(container.querySelector('[data-testid="chat-operation-status"]'), null);
  }
  state.messages = [{ id: 'saved', role: 'model', text: 'Synthetic saved reply' }]; await render();
  const saved = container.querySelector('[data-testid="timeline"] p'); state.loading = true; await render();
  assert.equal(container.querySelector('[data-testid="timeline"] p'), saved); assert.equal(container.querySelector('[data-testid="chat-operation-status"]'), null);
  assert.match(container.textContent, /正在重新核對聊天/);
  state.loading = false; state.error = 'Synthetic read failure'; await render(); assert.match(container.textContent, /Synthetic read failure/);
  value.scopeKey = 'new-child'; value.model.selectedChildId = uuid(4);
  Object.assign(state, { selectedChildId: uuid(4), messages: [], loadedAt: null, loading: true, error: null }); await render();
  assert.equal(container.querySelector('[data-testid="chat-empty-prompt"]'), null); assert.ok(container.querySelector('[data-testid="chat-spinner"]'));
  assert.notEqual(container.querySelector('[data-testid="timeline"]'), timeline);
});
