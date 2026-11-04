const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

test('class concern and growth targets require independent negotiated support across retained selections and owner submission', async () => {
  const { handoverClassDestination, handoverClassDestinations, handoverClassEnrolmentDestination } = await import('../src/production/handover-class-targets.ts');
  const { HandoverImportOwner } = await import('../src/production/HandoverImportOwner.ts');
  const { createHandoverApi } = await import('../../src/client/handover-api.ts');
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, at = '2026-11-05T00:00:00Z';
  const grant = { childId: id(20), childName: 'Class child', version: 1, modules: ['care', 'concerns', 'growth'] };
  const room = { id: id(10), kind: 'class', name: 'Synthetic class', role: 'caregiver', version: 1 };
  const state = { identityKey: 'teacher:1:class', userId: 'teacher', online: true, selected: room, pending: null, busy: false,
    rosterLoaded: true, shares: { items: [grant] } };
  const teachers = { identityKey: 'teacher:1:teachers', userId: 'teacher', spaces: { items: [] }, selected: null };
  let enabled, growthEnabled, period = null, failCapability = false; const writes = [], headers = [];
  const upload = () => ({ id: id(1), version: 2, filename: 'class-concerns.zip', state: 'ready', bytes: 3, error: null,
    createdAt: at, expiresAt: '2026-11-06T00:00:00Z', preview: { integrity: 'trusted', manifestSha256: 'c'.repeat(64),
      children: [{ id: id(2), displayName: 'Source child' }], coverage: [{ section: 'concerns', childId: id(2), items: 1 }],
      header: { format: 'yuyoufang-data', version: 1, packageId: id(3), packageVersion: 1, createdAt: at, purpose: 'handover',
        source: { serverId: 'synthetic.test', accountId: 'source' }, selection: { childIds: [id(2)], modules: ['concerns', 'growth'], period } } } });
  const api = createHandoverApi('https://synthetic.test', async (url, init) => {
    if (url.endsWith('/capabilities')) {
      headers.push(new Headers(init.headers));
      return failCapability ? Response.json({ error: { code: 'unavailable' } }, { status: 503 })
        : Response.json({ classEnrolment: true, ...(enabled ? { classConcernImports: true } : {}), ...(growthEnabled ? { classGrowthImports: true } : {}) });
    }
    if (url.includes('/package-uploads/')) return Response.json(upload());
    const command = JSON.parse(init.body); writes.push(command);
    return Response.json({ id: command.opId, version: 1, uploadId: id(1), packageId: id(3), packageVersion: 1,
      manifestSha256: 'c'.repeat(64), integrity: 'trusted', targets: command.targets.map(row => ({ ...row,
        target: 'createInClassId' in row.target ? { childId: id(90), spaceId: row.target.createInClassId } : row.target })),
      state: 'queued', processedItems: 0, totalItems: 1, counts: { created: 0, updated: 0, skipped: 0, conflict: 0 }, error: null, createdAt: at, updatedAt: at });
  });
  const owner = new HandoverImportOwner(api); owner.syncContext('teacher', 'teacher:1', true);
  await owner.readImportCapabilities();
  assert.deepEqual(headers[0].get('x-handover-class-features').split(/[\s,]+/u), ['concerns', 'growth']);
  assert.equal(headers[0].get('x-handover-original-modules'), '1');
  assert.equal(owner.getSnapshot().classConcernImportsEnabled, false, 'Old servers cannot enable shared concern imports');
  assert.equal(owner.getSnapshot().classGrowthImportsEnabled, false, 'Old servers cannot enable shared growth imports');
  assert.equal(handoverClassDestination(state, grant, teachers, {}).modules.includes('concerns'), false);
  await owner.openUpload(id(1));
  const oldTarget = { sourceChildId: id(2), target: { childId: id(20), spaceId: id(10) }, sections: ['concerns'] };
  await owner.create([oldTarget], false); assert.equal(writes.length, 0);
  enabled = true; await owner.readImportCapabilities();
  const existing = handoverClassDestination(state, grant, teachers, { concerns: owner.getSnapshot().classConcernImportsEnabled });
  assert.deepEqual(existing.modules, ['care', 'concerns']);
  assert.equal(handoverClassDestination(state, { ...grant, modules: ['care'] }, teachers, { concerns: true }).modules.includes('concerns'), false);
  assert.equal(handoverClassDestination({ ...state, selected: { ...room, kind: 'family' } }, grant, teachers, { concerns: true, growth: true }), null);
  assert.equal(handoverClassDestination({ ...state, selected: { ...room, role: 'viewer' } }, grant, teachers, { concerns: true, growth: true }), null);
  const enrolment = handoverClassEnrolmentDestination(state, teachers, true, { concerns: true });
  assert.ok(enrolment.modules.includes('concerns'));
  assert.equal(enrolment.modules.some(module => ['sources', 'chat', 'growth'].includes(module)), false);
  assert.equal(handoverClassEnrolmentDestination(state, teachers, true, {}).modules.includes('concerns'), false);
  await owner.create([oldTarget], false); assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].targets, [oldTarget]);
  period = { from: '2026-11-02T16:00:00.000Z', to: '2026-11-04T15:59:59.999Z' };
  await owner.openUpload(id(1));
  const newTarget = { sourceChildId: id(2), target: { createInClassId: id(10) }, sections: ['concerns'] };
  await owner.create([newTarget], false); assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].targets, [newTarget]);
  await owner.openUpload(id(1)); enabled = false; await owner.readImportCapabilities();
  const retained = handoverClassDestinations({ ...state, shares: { items: [] } }, [existing], teachers, {});
  assert.equal(retained.some(target => target.modules.includes('concerns')), false, 'Retained targets cannot retain a revoked feature');
  assert.notEqual(handoverClassEnrolmentDestination(state, teachers, true, {}).basis, enrolment.basis);
  await owner.create([oldTarget], false); await owner.create([newTarget], false);
  assert.equal(writes.length, 2, 'A stale owner activation cannot bypass absent capabilities for either target kind');
  enabled = true; await owner.readImportCapabilities(); failCapability = true; await owner.readImportCapabilities();
  assert.equal(owner.getSnapshot().classConcernImportsEnabled, false, 'Failed capability refreshes fail closed');
  failCapability = false; enabled = false; growthEnabled = true; await owner.readImportCapabilities();
  assert.equal(owner.getSnapshot().classConcernImportsEnabled, false);
  assert.equal(owner.getSnapshot().classGrowthImportsEnabled, true, 'Growth can be enabled independently of concerns');
  const growthFeatures = { concerns: false, growth: true }, growthTarget = handoverClassDestination(state, grant, teachers, growthFeatures);
  assert.deepEqual(growthTarget.modules, ['care', 'growth']);
  assert.equal(handoverClassDestination(state, { ...grant, modules: ['care', 'concerns'] }, teachers, growthFeatures).modules.includes('growth'), false);
  const growthEnrolment = handoverClassEnrolmentDestination(state, teachers, true, growthFeatures);
  assert.ok(growthEnrolment.modules.includes('growth')); assert.equal(growthEnrolment.modules.includes('concerns'), false);
  period = null; await owner.openUpload(id(1));
  await owner.create([oldTarget], false); assert.equal(writes.length, 2, 'Growth capability cannot permit concerns');
  const oldGrowth = { ...oldTarget, sections: ['growth'] }, newGrowth = { ...newTarget, sections: ['growth'] };
  await owner.create([oldGrowth], false); assert.deepEqual(writes[2].targets, [oldGrowth]);
  period = { from: '2026-11-02T16:00:00.000Z', to: '2026-11-04T15:59:59.999Z' }; await owner.openUpload(id(1));
  await owner.create([newGrowth], false); assert.deepEqual(writes[3].targets, [newGrowth]);
  await owner.openUpload(id(1)); growthEnabled = false; await owner.readImportCapabilities();
  assert.equal(handoverClassDestinations({ ...state, shares: { items: [] } }, [growthTarget], teachers, {}).some(target => target.modules.includes('growth')), false);
  assert.notEqual(handoverClassEnrolmentDestination(state, teachers, true, {}).basis, growthEnrolment.basis);
  await owner.create([oldGrowth], false); await owner.create([newGrowth], false); assert.equal(writes.length, 4, 'Stale growth targets fail closed');
  await owner.create([{ ...oldGrowth, target: { childId: id(20), spaceId: null } }], false);
  assert.equal(writes.length, 5, 'Personal growth imports retain their existing capability-independent flow');
  growthEnabled = true; await owner.readImportCapabilities(); failCapability = true; await owner.readImportCapabilities();
  assert.equal(owner.getSnapshot().classGrowthImportsEnabled, false);
  owner.syncContext('other-teacher', 'other-teacher:1', true);
  assert.equal(owner.getSnapshot().classConcernImportsEnabled, false);
  assert.equal(owner.getSnapshot().classGrowthImportsEnabled, false);
});

test('class import maps several sources through the paged roster and invalidates changed admission', async () => {
  const root = path.resolve(__dirname, '../..'), id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const jsx = (type, props, key) => ({ type, props, key }), noop = () => {};
  let production, classController, teacherController, current;
  const hooks = { useState(initial) { const view = current, n = view.cursor++;
    if (!(n in view.slots)) view.slots[n] = initial;
    return [view.slots[n], next => { const value = typeof next === 'function' ? next(view.slots[n]) : next;
      if (value !== view.slots[n]) { view.slots[n] = value; view.changed = true; } }]; },
    useRef(value) { const view = current, n = view.cursor++; return view.slots[n] ??= { current: value }; },
    useEffect(fn, deps) { hooks.useLayoutEffect(fn, deps); }, useSyncExternalStore: (_s, get) => get(),
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
    new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', output)(name => {
      if (name in mocks) return mocks[name]; if (!name.startsWith('.')) return require(name);
      const target = path.resolve(path.dirname(filename), name);
      return load(path.relative(root, fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx'));
    }, module, module.exports, () => 1, noop); return module.exports;
  }
  const { SharingController } = load('frontend/src/production/SharingController.ts');
  const classroom = (n, role = 'caregiver') => ({ id: id(n), kind: 'class', name: `Class ${n}`, role, version: 1 });
  const rooms = new Map([[id(10), classroom(10)], [id(11), classroom(11, 'viewer')],
    [id(12), { ...classroom(12), teacherSpaceId: id(13), teacherSpaceVersion: 1 }],
    [id(13), { id: id(13), kind: 'teachers', name: 'Teachers', role: 'caregiver', version: 1 }], [id(14), classroom(14)]]);
  const first = { childId: id(20), childName: 'Same name', version: 1, modules: ['care', 'tasks', 'memory', 'growth', 'concerns'] },
    second = { childId: id(21), childName: 'Second student', version: 1, modules: ['profile', 'documents', 'attachments'] };
  const reads = [], empty = () => ({ items: [], nextCursor: null });
  const api = { classes: async () => ({ items: [rooms.get(id(10)), rooms.get(id(11)), rooms.get(id(14))], nextCursor: null }),
    teachers: async () => ({ items: [rooms.get(id(13))], nextCursor: null }),
    async space(spaceId) { reads.push(['space', spaceId]); return { ...rooms.get(spaceId) }; },
    members: async () => empty(), invitations: async () => empty(),
    teacherClasses: async () => ({ items: [rooms.get(id(12))], nextCursor: null }),
    async roster(spaceId, _user, _signal, cursor, query = '') {
      reads.push(['roster', spaceId, cursor, query]);
      if (spaceId === id(14)) return empty();
      return query ? { items: [second], nextCursor: null } : cursor ? { items: [second], nextCursor: null } : { items: [first], nextCursor: 'roster-next' };
    }, submit() { assert.fail('Import target selection never creates students'); } };
  classController = new SharingController(api, 'class'); teacherController = new SharingController(api, 'teachers');
  classController.syncContext('teacher', 'teacher:1:sharing:class:1', true); teacherController.syncContext('teacher', 'teacher:1:sharing:teachers:1', true);
  await classController.loadSpaces(); await teacherController.loadSpaces();
  let enableClassEnrolment = false, capabilityReads = 0, enrolmentOutcome = 'pending'; const enrolmentReads = [];
  const sent = [], state = { identityKey: 'teacher:1', userId: 'teacher', busy: null, pending: null, items: [], uploads: [], classEnrolmentEnabled: false, enrolmentResults: null,
    upload: { id: id(1), filename: 'class.zip', state: 'ready', bytes: 3, preview: { integrity: 'trusted', manifestSha256: 'a'.repeat(64),
      header: { source: { serverId: 'source' }, selection: { modules: ['care', 'profile', 'tasks', 'memory', 'documents', 'attachments', 'sources', 'chat', 'concerns', 'growth'], period: null } },
      children: [{ id: id(2), displayName: 'Same name' }, { id: id(3), displayName: 'Other source' }],
      coverage: [{ childId: id(2), section: 'instructions', items: 1 }] } } };
  production = { owner: { handoverImportOwner: { clearComparison: noop, subscribe: noop, getSnapshot: () => state, create: async (...args) => sent.push(args), load: async () => {}, loadUploads: async () => {},
    readImportCapabilities: async () => { capabilityReads++; state.classEnrolmentEnabled = enableClassEnrolment; },
    readEnrolments: async batchId => { enrolmentReads.push(batchId); state.enrolmentResults = { batchId,
      items: [{ sourceChildId: id(2), target: { childId: id(50), spaceId: id(10) }, outcome: enrolmentOutcome, error: null }] }; } },
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
  const options = source => destination(source).props.options;
  assert.equal(options('Same name').some(option => option.value.startsWith('class-new:')), false);
  await settle(() => control('接收班級').props.onChange(id(14)));
  assert.equal(options('Same name').some(option => option.value.startsWith('class-new:')), false, 'unknown or unsupported capability cannot offer enrolment');
  enableClassEnrolment = true;
  nodes(view.tree).find(node => node.type === 'Dialog').props.onClose(); render();
  await settle(() => control('查看上載與匯入選擇').props.onPress()); render();
  const newStudent = `class-new:${id(14)}`;
  assert.ok(options('Same name').some(option => option.value === newStudent && option.label.includes('在此班新增')), 'an empty writable class offers explicit enrolment only after capability verification');
  assert.equal(destination('Same name').props.value, '', 'new students are never selected automatically');
  assert.equal(capabilityReads, 2); render(); render(); assert.equal(capabilityReads, 2, 'capability responses must not create a React retry loop');
  for (const name of ['Same name', 'Other source']) { control(name).props.onChange(false); render(); control(name).props.onChange(true); render(); }
  destination('Same name').props.onChange(newStudent); render(); destination('Other source').props.onChange(newStudent); render();
  assert.equal(control('開始匯入').props.disabled, false, 'an empty roster does not block explicit new students');
  const beforeEnrol = sent.length; await settle(() => control('開始匯入').props.onPress());
  assert.deepEqual(sent[beforeEnrol][0], [
    { sourceChildId: id(2), target: { createInClassId: id(14) }, sections: ['care', 'profile', 'tasks', 'documents', 'attachments'] },
    { sourceChildId: id(3), target: { createInClassId: id(14) }, sections: ['care', 'profile', 'tasks', 'memory', 'documents', 'attachments'] }]);
  const priorSubmit = control('開始匯入').props.onPress; state.classEnrolmentEnabled = false;
  await priorSubmit(); assert.equal(sent.length, beforeEnrol + 1, 'a stale event cannot use a disabled capability'); render();
  assert.equal(destination('Same name').props.value, '', 'capability loss invalidates planned enrolments');
  state.classEnrolmentEnabled = true; rooms.get(id(10)).role = 'caregiver'; rooms.get(id(10)).version++;
  await settle(() => control('接收班級').props.onChange(id(10)));
  assert.equal(destination('Same name').props.value, '', 'changing classes does not carry a new-student choice');
  destination('Same name').props.onChange(`class:${id(10)}:${id(20)}`); render();
  destination('Same name').props.onChange(`class-new:${id(10)}`); render();
  await settle(() => control('載入更多班級學生').props.onPress());
  destination('Other source').props.onChange(`class:${id(10)}:${id(21)}`); render();
  const mixed = sent.length; await settle(() => control('開始匯入').props.onPress());
  assert.deepEqual(sent[mixed][0], [
    { sourceChildId: id(2), target: { createInClassId: id(10) }, sections: ['tasks'] },
    { sourceChildId: id(3), target: { childId: id(21), spaceId: id(10) }, sections: ['profile', 'documents', 'attachments'] }], 'one package mixes explicit new students and verified members without broadening selected modules');
  state.items = [{ id: id(40), state: 'queued', createdAt: '2026-11-05T00:00:00Z', targets: [
    { sourceChildId: id(2), target: { childId: id(50), spaceId: id(10) }, sections: ['tasks'] }], processedItems: 0, totalItems: 1,
    counts: { created: 0, updated: 0, skipped: 0, conflict: 0 }, error: null }]; render();
  assert.deepEqual(enrolmentReads, [], 'batch rendering and polling setup do not fetch per-student results');
  await settle(() => control('讀取逐名入班結果').props.onPress());
  const text = tree => tree == null || tree === false ? '' : Array.isArray(tree) ? tree.map(text).join('') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
  assert.ok(text(view.tree).includes('入班狀態：待處理，尚未建立學生'));
  render(); render(); assert.deepEqual(enrolmentReads, [id(40)]);
  enrolmentOutcome = 'created'; await settle(() => control('讀取逐名入班結果').props.onPress());
  assert.ok(text(view.tree).includes('入班狀態：已建立班級學生'));
  const readsBeforeReopen = capabilityReads, resultsBeforeReopen = enrolmentReads.length;
  state.upload = null; state.classEnrolmentEnabled = false; state.enrolmentResults = null; view.slots = [];
  render(); await new Promise(setImmediate); render();
  assert.equal(capabilityReads, readsBeforeReopen + 1, 'a restored class batch can discover capability without a new package preview');
  assert.ok(control('讀取逐名入班結果'));
  assert.equal(enrolmentReads.length, resultsBeforeReopen, 'restored batches still read results only on explicit request');
  render(); render(); assert.equal(capabilityReads, readsBeforeReopen + 1);
});
