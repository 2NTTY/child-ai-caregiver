const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

test('class import maps several sources through the paged roster and invalidates changed admission', async () => {
  const root = path.resolve(__dirname, '../..'), id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const jsx = (type, props, key) => ({ type, props, key }), noop = () => {};
  let production, classController, teacherController, current;
  const hooks = { useState(initial) { const view = current, n = view.cursor++;
    if (!(n in view.slots)) view.slots[n] = initial;
    return [view.slots[n], next => { const value = typeof next === 'function' ? next(view.slots[n]) : next;
      if (value !== view.slots[n]) { view.slots[n] = value; view.changed = true; } }]; },
    useRef: () => ({ current: null }), useEffect: noop, useSyncExternalStore: (_s, get) => get(),
    useLayoutEffect(fn, deps) { const view = current, n = view.cursor++, previous = view.slots[n];
      if (!previous || deps.some((value, index) => value !== previous[index])) { view.slots[n] = deps; view.effects.push(fn); } } };
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative); if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mocks = { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
      'react-native': { View: 'View', StyleSheet: { create: value => value }, Platform: { OS: 'web' } }, 'react-native-paper': { Text: 'Text' },
      '../../production/ProductionProvider': { useProduction: () => production },
      '../../production/useProductionSharing': { useProductionSharing: mode => { const controller = mode === 'teachers' ? teacherController : classController; return { controller, state: controller.getSnapshot() }; } },
      '../../platform/package-import': { PACKAGE_IMPORT_MAX_BYTES: 256 * 1024 * 1024 },
      '../../theme': { colors: {}, readingType: {}, spacing: {} },
      '../ui': { AppButton: 'Button', AppSelect: 'Select', AppTextField: 'Field' }, '../AppCheckbox': { AppCheckbox: 'Check' },
      '../FormDialog': { FormDialog: 'Dialog' }, './HandoverImportResults': { HandoverImportResults: 'Results' } };
    new Function('require', 'module', 'exports', output)(name => {
      if (name in mocks) return mocks[name]; if (!name.startsWith('.')) return require(name);
      const target = path.resolve(path.dirname(filename), name);
      return load(path.relative(root, fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx'));
    }, module, module.exports); return module.exports;
  }
  const { SharingController } = load('frontend/src/production/SharingController.ts');
  const classroom = (n, role = 'caregiver') => ({ id: id(n), kind: 'class', name: `Class ${n}`, role, version: 1 });
  const rooms = new Map([[id(10), classroom(10)], [id(11), classroom(11, 'viewer')],
    [id(12), { ...classroom(12), teacherSpaceId: id(13), teacherSpaceVersion: 1 }],
    [id(13), { id: id(13), kind: 'teachers', name: 'Teachers', role: 'caregiver', version: 1 }]]);
  const first = { childId: id(20), childName: 'Same name', version: 1, modules: ['care', 'tasks', 'memory', 'growth', 'concerns'] },
    second = { childId: id(21), childName: 'Second student', version: 1, modules: ['profile', 'documents', 'attachments'] };
  const reads = [], empty = () => ({ items: [], nextCursor: null });
  const api = { classes: async () => ({ items: [rooms.get(id(10)), rooms.get(id(11))], nextCursor: null }),
    teachers: async () => ({ items: [rooms.get(id(13))], nextCursor: null }),
    async space(spaceId) { reads.push(['space', spaceId]); return { ...rooms.get(spaceId) }; },
    members: async () => empty(), invitations: async () => empty(),
    teacherClasses: async () => ({ items: [rooms.get(id(12))], nextCursor: null }),
    async roster(spaceId, _user, _signal, cursor, query = '') {
      reads.push(['roster', spaceId, cursor, query]);
      return query ? { items: [second], nextCursor: null } : cursor ? { items: [second], nextCursor: null } : { items: [first], nextCursor: 'roster-next' };
    }, submit() { assert.fail('Import target selection never creates students'); } };
  classController = new SharingController(api, 'class'); teacherController = new SharingController(api, 'teachers');
  classController.syncContext('teacher', 'teacher:1:sharing:class:1', true); teacherController.syncContext('teacher', 'teacher:1:sharing:teachers:1', true);
  await classController.loadSpaces(); await teacherController.loadSpaces();
  const sent = [], state = { identityKey: 'teacher:1', userId: 'teacher', busy: null, pending: null, items: [], uploads: [],
    upload: { id: id(1), filename: 'class.zip', state: 'ready', bytes: 3, preview: { integrity: 'trusted', manifestSha256: 'a'.repeat(64),
      header: { source: { serverId: 'source' }, selection: { modules: ['care', 'profile', 'tasks', 'memory', 'documents', 'attachments', 'sources', 'chat', 'concerns', 'growth'], period: null } },
      children: [{ id: id(2), displayName: 'Same name' }, { id: id(3), displayName: 'Other source' }],
      coverage: [{ childId: id(2), section: 'instructions', items: 1 }] } } };
  production = { owner: { handoverImportOwner: { subscribe: noop, getSnapshot: () => state, create: async (...args) => sent.push(args) },
    sharedChild: { subscribe: noop, getSnapshot: () => ({ phase: 'idle' }) } }, userId: 'teacher', identityKey: 'teacher:1', online: true,
    recordsState: { children: [] }, account: { gate: 'ready', busy: null, deletion: { phase: 'idle' } } };
  const component = load('frontend/src/components/account/HandoverImportControls.tsx').HandoverImportControls;
  const view = { slots: [], cursor: 0, effects: [] };
  function render() { let attempts = 0; do { assert.ok(attempts++ < 10); current = view; view.cursor = 0; view.changed = false; view.effects = [];
    view.tree = component(); for (const effect of view.effects) effect(); } while (view.changed); }
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const control = label => nodes(view.tree).find(node => node.props?.label === label);
  const settle = async action => { action(); await new Promise(setImmediate); render(); };
  const destination = source => nodes(view.tree).find(node => node.props?.label === `接收「${source}」的對象`);
  render(); control('查看上載與匯入選擇').props.onPress(); render();
  const classPicker = control('接收班級'); assert.ok(classPicker, 'the unified importer must offer authorized class rosters');
  assert.equal(classPicker.props.options.some(option => option.value === id(11)), false, 'viewer classes are not import targets');
  await settle(() => classPicker.props.onChange(id(10)));
  control('Same name').props.onChange(true); render(); control('Other source').props.onChange(true); render();
  assert.equal(destination('Same name').props.value, '', 'matching names never select a target');
  assert.equal(reads.filter(row => row[0] === 'roster').length, 1, 'opening a class loads one roster page only');
  destination('Same name').props.onChange(`class:${id(10)}:${id(20)}`); render();
  await settle(() => control('載入更多班級學生').props.onPress());
  assert.deepEqual(reads.filter(row => row[0] === 'roster').at(-1), ['roster', id(10), 'roster-next', '']);
  destination('Other source').props.onChange(`class:${id(10)}:${id(21)}`); render();
  assert.equal(reads.filter(row => row[0] === 'space').length, 1, 'several source mappings reuse one class detail');
  await settle(() => control('開始匯入').props.onPress());
  assert.deepEqual(sent[0][0], [
    { sourceChildId: id(2), target: { spaceId: id(10), childId: id(20) }, sections: ['care', 'tasks'] },
    { sourceChildId: id(3), target: { spaceId: id(10), childId: id(21) }, sections: ['profile', 'documents', 'attachments'] }]);
  control('搜尋班級學生').props.onChangeText('Second'); render();
  await settle(() => control('搜尋接收名冊').props.onPress());
  assert.equal(control('開始匯入').props.disabled, false, 'searching another student retains explicitly selected same-scope targets');
  assert.deepEqual(reads.filter(row => row[0] === 'roster').at(-1), ['roster', id(10), undefined, 'Second']);
  const staleSubmit = control('開始匯入').props.onPress;
  first.modules = ['tasks']; await classController.searchRoster('');
  await staleSubmit(); assert.equal(sent.length, 1, 'a stale activation cannot submit an earlier data scope'); render();
  assert.equal(destination('Same name').props.value, '', 'changed grant modules invalidate the original choice');
  assert.equal(control('開始匯入').props.disabled, true);
  destination('Same name').props.onChange(`class:${id(10)}:${id(20)}`); render();
  rooms.get(id(10)).role = 'viewer'; await classController.refreshSelected(); render();
  assert.equal(control('開始匯入').props.disabled, true, 'a read-only role invalidates prior mappings');
  await settle(() => control('接收教師空間').props.onChange(id(13)));
  assert.ok(control('接收班級').props.options.some(option => option.value === id(12)), 'inherited classes use the existing teacher-space list');
  await settle(() => control('接收班級').props.onChange(id(12)));
  assert.equal(control('開始匯入').props.disabled, true, 'changing class cannot reuse either old student mapping');
  assert.equal(destination('Same name').props.value, '');
  destination('Same name').props.onChange(`class:${id(12)}:${id(20)}`); render();
  rooms.get(id(12)).version++; await classController.refreshSelected(); render();
  assert.equal(destination('Same name').props.value, '', 'class scope changes require a new explicit mapping');
  destination('Same name').props.onChange(`class:${id(12)}:${id(20)}`); render();
  rooms.get(id(13)).version++; rooms.get(id(13)).role = 'viewer'; await teacherController.refreshSelected(); render();
  assert.equal(destination('Same name').props.value, '', 'newer parent-space admission invalidates the cached class view');
});
