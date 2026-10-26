const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing test-only jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<div id="root"></div>', { url: 'https://synthetic.invalid/' });
Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const React = req('react');
const { createRoot } = req('react-dom/client');
const ts = req('typescript');
let width = 1440, pathname = '/', ready = true, photoProps, photoOpens = 0, networkCalls = 0;
global.fetch = () => { networkCalls++; throw new Error('External network is forbidden.'); };
const flatten = styles => Object.assign({}, ...[styles].flat(Infinity).filter(Boolean));
function host(tag, props) {
  const { children, testID, accessibilityLabel, accessibilityRole, nativeID, role, style, dataSet, onPress, onFocus, onBlur, disabled } = props;
  const result = { role: role ?? (accessibilityRole === 'header' ? 'heading' : accessibilityRole), id: nativeID, 'aria-label': accessibilityLabel, 'data-testid': testID,
    onClick: onPress, onFocus, onBlur, disabled, style: flatten(typeof style === 'function' ? style({ pressed: false }) : style) };
  for (const [key, value] of Object.entries(props)) if (key.startsWith('aria-') || key === 'tabIndex') result[key] = value;
  for (const [key, value] of Object.entries(dataSet ?? {})) result[`data-${key.replace(/[A-Z]/g, x => '-' + x.toLowerCase())}`] = value;
  return React.createElement(tag, result, children);
}
const View = props => host('div', props);
const Pressable = props => host('button', props);
const Text = props => host('span', props);
const AppButton = ({ label, accessibilityLabel, onPress, disabled, ...props }) => host('button', { ...props, accessibilityLabel: accessibilityLabel ?? label, onPress, disabled, children: label });
const native = { View, Pressable, Platform: { OS: 'web', select: x => x.web ?? x.default }, useWindowDimensions: () => ({ width, height: 900 }), StyleSheet: { create: x => x, flatten } };
const cache = new Map();
function load(file) {
  const absolute = path.resolve(root, file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const module = { exports: {} };
  cache.set(absolute, module);
  const source = fs.readFileSync(absolute, 'utf8');
  const output = ts.transpileModule(source, { fileName: absolute, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual(output.diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error), [], file);
  new Function('require', 'module', 'exports', output.outputText)(name => {
    if (name === 'react' || name === 'react/jsx-runtime') return req(name);
    if (name === 'react-native') return native;
    if (name === 'react-native-paper') return { Text, ActivityIndicator: () => React.createElement('span', {}, 'Loading'), MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: x => x };
    if (name === 'expo-router') return { usePathname: () => pathname };
    if (name.endsWith('/ui')) return { AppButton, TextLink: AppButton, SectionCard: View, SectionHeader: ({ title }) => React.createElement(Text, { accessibilityRole: 'header' }, title) };
    if (name.endsWith('/AppIcon')) return { AppIcon: () => null };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: ({ contentContainerStyle, style, ...props }) => View({ ...props, style: contentContainerStyle }) };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width, ref: null, onLayout() {} }) };
    if (name.endsWith('/FirstScreenGate')) return { useFirstScreenReady: () => ready };
    if (name.endsWith('/BackgroundSurface')) return { BackgroundSurface: View };
    if (name.endsWith('/motion/preferences')) return { useMotionPreferences: () => ({ enabled: false }) };
    if (name.endsWith('/PhotoFilePicker')) return { PhotoFilePicker: props => {
      photoProps = props;
      return props.renderTrigger({ disabled: props.disabled, reading: false, onPress() { photoOpens++; } });
    } };
    if (!name.startsWith('.')) return req(name);
    const resolved = path.resolve(path.dirname(absolute), name);
    return load(fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : `${resolved}.tsx`);
  }, module, module.exports);
  return module.exports;
}
const { HomeDashboard } = load('src/components/HomeDashboard.tsx');
const { HomeQuickActions } = load('src/components/HomeQuickActions.tsx');
const { HomeAgentImportant } = load('src/components/HomeAgentImportant.tsx');
const app = createRoot(document.getElementById('root'));
const calls = [];
const actions = { open: value => calls.push(['open', value]), refresh: () => calls.push(['refresh']), reviewOperation: () => calls.push(['review']), openAgentPhoto: value => calls.push(['photo', value]) };
const makeItem = (id, destination) => ({ id, title: `Synthetic ${id}`, detail: `Detail ${id}`, statusLabel: '待查看', sourceLabel: 'Synthetic source', action: { label: `Open ${id}`, destination } });
const model = () => ({ scopeKey: 'scope-a', caregiverName: 'Synthetic Parent', selectedChildId: 'a', children: [{ id: 'a', displayName: 'Synthetic Child', ageLabel: '年齡未知', regionLabel: '未提供', allergiesLabel: null, profileConfirmed: false }], connection: 'online', profileLoad: 'ready', recordsLoad: 'ready', records: [], lastReadLabel: 'Synthetic read time', guideStatus: 'complete', operation: { state: 'none', title: '', detail: '' }, overview: { childId: 'a', agentImportant: { state: 'ready', loadedAt: '2026-10-25T00:00:00Z', synthetic: true, items: [{ ...makeItem('decision', 'chat'), whyNow: 'Synthetic reason', source: { kind: 'agent_run', runId: 'run-a', createdAt: '2026-10-25T00:00:00Z', status: 'completed' } }] }, attention: { state: 'ready', items: [makeItem('task', 'tasks')] }, ongoing: { state: 'ready', items: [makeItem('concern', 'growth')] } } });
const render = async (value, Component = HomeDashboard, extra = {}) => { await React.act(async () => app.render(React.createElement(Component, { model: value, actions, ...extra }))); };
const clear = async () => { await React.act(async () => app.render(null)); calls.length = 0; width = 1440; pathname = '/'; ready = true; photoProps = null; photoOpens = 0; };
const byId = id => document.querySelector(`[data-testid="${id}"]`);
const button = label => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label);
const click = async node => { assert.ok(node, 'Expected action is reachable'); await React.act(async () => node.click()); };
const before = (a, b) => assert.ok(byId(a).compareDocumentPosition(byId(b)) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, `${a} before ${b}`);

test('daily brief prioritizes decisions and gives agenda and concerns equal columns at all target widths', async () => {
  for (const nextWidth of [320, 390, 1024, 1440]) {
    await clear(); width = nextWidth;
    const value = model(); value.operation = { state: 'unknown', title: 'Synthetic operation', detail: 'Check original result' };
    await render(value);
    assert.equal(document.querySelectorAll('[aria-level="1"]').length, 1);
    assert.ok(byId('home-daily-brief').textContent.includes('Synthetic Child'));
    before('home-daily-brief', 'home-operation-recovery'); before('home-operation-recovery', 'home-agent-important');
    before('home-agent-important', 'home-action-summary'); before('home-action-summary', 'home-ongoing');
    const assistant = nextWidth < 1024 ? 'home-workspace-start' : 'home-quick-actions'; before('home-ongoing', assistant);
    assert.equal(document.querySelectorAll('[data-testid="home-agent-camera"]').length, nextWidth < 1024 ? 0 : 1);
    if (nextWidth >= 1024) assert.equal(byId('home-actions-column').style.flex, byId('home-ongoing-column').style.flex);
    assert.equal(document.body.textContent.includes('從一個問題，走到清楚的下一步'), false);
  }
  const dock = fs.readFileSync(path.join(root, 'src/components/agent/MobileQuickInputDock.tsx'), 'utf8');
  assert.match(dock, /<PhotoFilePicker disabled=\{!enabled \|\| voiceOpen\}/); assert.match(dock, /onPick=\{actions.openAgentPhoto\}/);
  await clear();
});

test('same-scope loading retains the original reminder disclosure; changing scope resets it', async () => {
  await clear(); const value = model(); await render(value);
  await click(button('為甚麼提醒我？')); assert.equal(button('為甚麼提醒我？').getAttribute('aria-expanded'), 'true');
  const sourceId = button('為甚麼提醒我？').getAttribute('aria-controls');
  assert.equal(document.getElementById(sourceId).getAttribute('aria-hidden'), 'false');
  await render({ ...value, overview: { ...value.overview, agentImportant: { ...value.overview.agentImportant, state: 'loading' } } });
  assert.equal(button('為甚麼提醒我？').getAttribute('aria-expanded'), 'true');
  assert.equal(button('為甚麼提醒我？').getAttribute('aria-controls'), sourceId);
  assert.equal(byId('home-agent-important').querySelector('[data-testid="read-state-loading"]'), null);
  await render({ ...value }); assert.equal(button('為甚麼提醒我？').getAttribute('aria-expanded'), 'true');
  await render({ ...value, scopeKey: 'scope-b' }); assert.equal(button('為甚麼提醒我？').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(calls, []); await clear();
});

test('all original navigation and unknown-operation recovery actions remain owner callbacks', async () => {
  await clear(); const value = model(); value.operation = { state: 'unknown', title: 'Synthetic operation', detail: 'Check only' }; await render(value);
  await click(button('Open decision')); await click(byId('home-overview-item-task')); await click(byId('home-overview-item-concern')); await click(button('查核這次結果'));
  await click(button('查看全部待辦')); await click(button('查看全部關注')); await click(button('用文字告訴助手')); await click(button('查看記錄及補改資料'));
  assert.deepEqual(calls, [['open', 'chat'], ['open', 'tasks'], ['open', 'growth'], ['review'], ['open', 'tasks'], ['open', 'growth'], ['open', 'chat'], ['open', 'care']]);
  assert.equal(button('重送'), undefined); await clear();
});

test('confirmed empty, unavailable, loading, failed reads and offline retry stay distinct', async t => {
  await clear(); const value = model();
  value.overview.agentImportant = { state: 'ready', items: [], loadedAt: null };
  value.overview.attention = { state: 'ready', items: [] }; value.overview.ongoing = { state: 'ready', items: [] };
  await render(value); assert.match(byId('home-agent-important').textContent, /目前沒有助手提醒/); assert.match(byId('home-action-summary').textContent, /目前沒有待辦事項/);
  value.overview.agentImportant.state = 'unavailable'; await render({ ...value });
  assert.match(byId('home-agent-important').textContent, /暫時無法顯示助手提醒/); assert.ok(button('前往助手'));
  value.overview.agentImportant.state = 'error'; value.overview.attention.state = 'error'; value.connection = 'offline'; await render({ ...value });
  assert.ok(button('重新讀取提醒').disabled); assert.ok(button('重新讀取待辦').disabled); await click(button('重新讀取提醒')); assert.deepEqual(calls, []);
  value.connection = 'online'; await render({ ...value }); await click(button('重新讀取提醒')); assert.deepEqual(calls, [['refresh']]);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try { value.overview.agentImportant.state = 'loading'; await render({ ...value }); await React.act(async () => t.mock.timers.tick(600)); assert.match(byId('read-state-loading').textContent, /正在讀取助手提醒/); }
  finally { await clear(); t.mock.timers.reset(); }
});

test('optional setup removes onboarding pressure and read timestamps without removing recovery or read-only state', async () => {
  await clear(); const value = model(); let presented = 0; ready = false;
  await render(value, HomeDashboard, { introductionPending: true, onIntroductionPresented: () => presented++ }); assert.equal(presented, 0);
  ready = true; await render(value, HomeDashboard, { introductionPending: true, onIntroductionPresented: () => presented++ }); assert.equal(presented, 1);
  value.children[0].accessRole = 'viewer'; await render({ ...value }); assert.match(byId('home-daily-brief').textContent, /唯讀檢視/);
  value.guideStatus = 'first_login'; await render({ ...value }); assert.equal(button('開始使用引導'), undefined); assert.equal(button('重新讀取'), undefined); assert.doesNotMatch(byId('home-daily-brief').textContent, /最近讀取|尚未有讀取時間/);
  value.guideStatus = 'unknown'; await render({ ...value }); assert.equal(button('前往設定'), undefined);
  value.guideStatus = 'first_login'; value.children = []; value.selectedChildId = null; await render({ ...value });
  await click(button('建立孩子檔案')); assert.deepEqual(calls.pop(), ['open', 'profile']); await click(button('查看使用說明')); assert.deepEqual(calls.pop(), ['open', 'guide']); assert.equal(byId('home-agent-important'), null);
  value.profileLoad = 'error'; await render({ ...value }); assert.equal(button('建立孩子檔案'), undefined); assert.ok(button('重新讀取孩子檔案'));
  await clear();
});

test('photo handoff stays draft-only and scope-bound, without a duplicate text action or network request', async () => {
  await clear(); const value = model(); await render(value, HomeQuickActions);
  assert.equal(document.querySelectorAll('[aria-label="用文字告訴助手"]').length, 1);
  await click(byId('home-agent-camera')); assert.equal(photoOpens, 1); assert.deepEqual(calls, []);
  const original = { uri: 'synthetic-only', filename: 'synthetic.png', mimeType: 'image/png' };
  await React.act(async () => photoProps.onPick(original)); assert.deepEqual(calls, [['photo', original]]);
  assert.ok(byId('home-agent-camera').disabled); assert.ok(button('用文字告訴助手').disabled);
  await render({ ...value }, HomeQuickActions); assert.ok(byId('home-agent-camera').disabled);
  await render({ ...value, scopeKey: 'scope-b' }, HomeQuickActions); assert.equal(byId('home-agent-camera').disabled, false);
  await React.act(async () => photoProps.onError('Synthetic file error')); assert.match(document.querySelector('[role="alert"]').textContent, /Synthetic file error/);
  await render({ ...value, scopeKey: null }, HomeQuickActions); assert.ok(byId('home-agent-camera').disabled); assert.equal(document.querySelector('[role="alert"]'), null);
  pathname = '/tasks'; await render(value, HomeQuickActions); assert.ok(byId('home-agent-camera').disabled); assert.equal(networkCalls, 0);
  await clear();
});

test('owner order and scope filtering remain authoritative rather than guessed from time or counts', async () => {
  await clear(); const value = model(); const lead = value.overview.agentImportant.items[0];
  value.overview.agentImportant.items = [lead, { ...lead, id: 'next', title: 'Synthetic next', source: { ...lead.source, createdAt: '2030-01-01T00:00:00Z' } }];
  await render(value, HomeAgentImportant);
  const ids = [...document.querySelectorAll('[data-testid^="home-agent-important-item-"]')].map(node => node.dataset.testid);
  assert.deepEqual(ids, ['home-agent-important-item-decision', 'home-agent-important-item-next']);
  await render({ ...value, overview: { ...value.overview, childId: 'another-child' } }, HomeAgentImportant); assert.equal(byId('home-agent-important-item-decision'), null);
  await render({ ...value, children: [] }, HomeAgentImportant); assert.equal(byId('home-agent-important'), null);
  await clear();
});

test('explicit DOM button names include important unknown and review status while callbacks remain navigation-only', async()=>{
 await clear();const value=model(),lead=value.overview.agentImportant.items[0];
 value.overview.agentImportant.items.push({...lead,id:'unknown',title:'核對原操作',source:{...lead.source,status:'unknown'}});
 value.overview.attention.items[0].statusLabel='待覆核';await render(value);
 const reminder=byId('home-agent-important-item-unknown'),task=byId('home-overview-item-task');
 assert.match(reminder.getAttribute('aria-label'),/結果未知.*核對原操作/);assert.match(task.getAttribute('aria-label'),/待覆核/);
 await click(reminder);await click(task);assert.deepEqual(calls,[['open','chat'],['open','tasks']]);await clear();
});
