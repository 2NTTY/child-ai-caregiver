import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Real growth forms, local draft hook and navigation guard; synthetic field/owner ports only.
function scenario(kind) {
  let visible = true, navigations = 0, submitted = 0, nextId = 0;
  const discarded = [], dirtyKeys = new Set();
  const topic = { id: 'preschool_development', title: 'Synthetic topic', version: 1, disabled: false,
    inputs: [{ key: 'context', label: 'Synthetic context', value: null, conflict: false, factRefs: [], choices: [{ value: 'observed', label: 'Observed' }] }] };
  const item = { id: 'item-a', childId: 'child', topicId: topic.id, version: 1, state: 'proposed', title: 'Synthetic suggestion', kind: 'observe', whyNow: 'Synthetic reason', advice: 'Synthetic advice', limits: 'Synthetic limits', sourceAvailable: true,
    source: { url: 'https://example.invalid', title: 'Synthetic source', section: 'Synthetic section', excerpt: 'Synthetic excerpt', versionId: 'source-version', checkedAt: '2026-10-21T00:00:00Z' }, evidence: { profileVersion: 1 }, updatedAt: '2026-10-21T00:00:00Z', taskId: null };
  const model = { scopeKey: 'scope', childId: 'child', access: 'editable', online: true, load: 'ready', busy: false, locked: false, dirty: false, epoch: 0, resetCounts: {}, missingTargets: [], operation: 'none', pending: null,
    page: { authorityVersion: 'authority-a', canManage: true, concerns: { state: 'ready', items: [] }, items: [item], topics: [topic], notices: [], eligibleAssignees: [] } };
  const pending = (kind, id, input, authorityVersion) => { submitted++; model.pending = { attempt: { kind, id, input: structuredClone(input), body: JSON.stringify(input), authorityVersion }, reviewed: false, reconfirm: false }; model.operation = 'unknown'; model.locked = true; };
  const actions = { markDirty(key) { dirtyKeys.add(key); model.dirty = true; }, discardLocalDraft(key) { const entry = model.pending?.attempt; if (!entry || `${entry.kind}:${entry.id}` !== key) dirtyKeys.delete(key); model.dirty = !!dirtyKeys.size; discarded.push(key); },
    createConcern: (input, authority) => pending('concern_create', 'new', input, authority), updateConcern() {}, decide: (item, input) => pending('item', item.id, input), updateTopic: (topic, input) => pending('topic', topic.id, input) };
  const ui = { AppButton: 'Button', AppSelect: 'Select', AppTextField: 'TextField', SectionCard: 'Section', SectionHeader: 'Heading' };
  const dialogs = { AppDialog: Object.assign('Dialog', { Title: 'Title', Content: 'Content', ScrollArea: 'ScrollArea', Actions: 'Actions' }) };
  const mocks = {
    'expo-router/react-navigation': { useNavigation: () => ({ dispatch() {} }), usePreventRemove() {} },
    'expo-router': { usePathname: () => '/growth', useRouter: () => ({ push() {} }), Link: 'Link' },
    'react-native': { View: 'View', Platform: { OS: 'android' }, Linking: {}, StyleSheet: { create: value => value } },
    '../components/AppDialog': dialogs, '../AppDialog': dialogs, './AppDialog': dialogs,
    'react-native-paper': { Text: 'Text', Portal: ({ children }) => children }, './AppScrollView': { AppScrollView: 'ScrollView' },
    './growth-styles': { growthStyles: {} }, '../components/growth/growth-styles': { growthStyles: {} },
    '../ui': ui, '../components/ui': ui,
    '../AppCheckbox': { AppCheckbox: 'Checkbox' }, '../components/AppCheckbox': { AppCheckbox: 'Checkbox' },
    '../DateTimeFields': { AppDateTimeField: 'DateField' }, '../components/DateTimeFields': { AppDateTimeField: 'DateField', AppTimeZoneSelect: 'TimeZone' },
    '../FormErrorSummary': { FormErrorSummary: 'ErrorSummary', FormFieldMessage: 'FieldMessage' },
    '../components/AppScrollView': { AppScrollView: 'ScrollView' },
    '../summary/SummaryDisclosure': { SummaryDisclosure: ({ children }) => children }, '../components/summary/SummaryDisclosure': { SummaryDisclosure: ({ children }) => children },
    '../components/growth/GrowthOperationRecovery': { GrowthOperationRecovery: () => null }, './GrowthOperationRecovery': { GrowthOperationRecovery: () => null },
    '../../theme': { colors: {}, spacing: {}, readingType: {}, typeScale: {} },
  };
  const h = harness(mocks);
  mocks.react = { ...h.react, useId: () => h.react.useRef(`growth-${++nextId}`).current };
  mocks['react-hook-form'] = {
    useForm: ({ defaultValues }) => {
      const state = h.react.useRef(structuredClone(defaultValues));
      return { control: state, reset: h.react.useCallback(values => { state.current = structuredClone(values); }, []), watch: name => name ? state.current[name] : state.current,
        setError() {}, setFocus() {}, formState: { errors: {} }, handleSubmit: callback => () => callback(state.current) };
    },
    Controller: ({ name, control, render }) => { const keys = name.split('.'); return render({ field: { value: keys.reduce((value, key) => value?.[key], control.current), onChange(value) { let obj = control.current; for (const key of keys.slice(0, -1)) obj = obj[key] ??= {}; obj[keys.at(-1)] = value; }, onBlur() {}, ref: null } }); },
  };
  const guard = h.load('src/preview/PreviewNavigationGuard.tsx');
  const { GrowthConcernManualFallback } = h.load('src/components/growth/GrowthConcernManualFallback.tsx');
  const { GrowthSuggestionSettings, TaskKnowledgeGrowthCandidates } = h.load('src/production/TaskKnowledgeGrowthCandidates.tsx');
  let leave;
  function RetainedOwner() { guard.usePreviewLeaveGuard(model.dirty, !!model.pending, 'child', undefined, true); return null; }
  function Page() { leave = guard.usePreviewNavigation(); return !visible ? null : kind === 'manual' ? h.jsx(GrowthConcernManualFallback, { model, actions, concern: null }) : kind === 'topic' ? h.jsx(GrowthSuggestionSettings, { model, actions }) : h.jsx(TaskKnowledgeGrowthCandidates, { model, actions, onTask() {} }); }
  const tree = h.jsx(guard.PreviewNavigationGuard, { children: [h.jsx(RetainedOwner, {}, 'owner'), h.jsx(Page, {}, 'page')] });
  const render = () => h.render(tree), host = (type, label) => h.hosts().find(n => n.type === type && (n.props.label === label || n.props.accessibilityLabel === label));
  const button = label => host('Button', label), field = label => host('TextField', label), checkbox = prefix => h.hosts().find(n => n.type === 'Checkbox' && n.props.label.startsWith(prefix));
  render();
  button(kind === 'attention' ? '查看來源與核對候選' : kind === 'manual' ? '新增關注' : '建議設定').props.onPress(); render();
  function edit() {
    if (kind === 'manual') { field('關注名稱').props.onChangeText('Synthetic unsent concern'); }
    else if (kind === 'topic') host('Select', '這次確認：Synthetic context').props.onChange('observed');
    else { host('Select', '這次決定').props.onChange('dismiss'); render(); field('關閉原因／備註（可留空，最多 1,000 字）').props.onChangeText('Synthetic unsent decision'); }
    render();
  }
  function submit() {
    if (kind === 'manual') {
      field('關注原因').props.onChangeText('Synthetic reason'); field('觀察內容').props.onChangeText('Synthetic observation'); host('DateField', '觀察時間').props.onChange('2026-10-21T00:00:00Z'); render();
      checkbox('我已核對對象、內容').props.onChange(true); render(); button('確認建立共享關注').props.onPress();
    } else if (kind === 'topic') { checkbox('我已核對所選近況').props.onChange(true); render(); button('確認保存所選近況').props.onPress(); }
    else { checkbox('我已核對候選').props.onChange(true); render(); button('確認提交這次成長決定').props.onPress(); }
    render();
  }
  return { h, model, actions, render, edit, submit, button, checkbox, discarded, dirtyKeys, host,
    request(intent = 'workspace') { leave(() => { visible = false; navigations++; }, intent); render(); }, counts: () => ({ navigations, submitted }),
  };
}
for (const kind of ['manual', 'topic', 'attention']) {
  test(`${kind} draft requires explicit leave approval and unrelated unknown cannot impersonate its frozen payload`, () => {
    const s = scenario(kind); s.edit(); s.request(); assert.equal(s.counts().navigations, 0); assert.ok(s.button('捨棄草稿並離開'));
    s.button('繼續編輯').props.onPress(); s.render(); assert.equal(s.model.dirty, true);
    s.model.pending = { attempt: { kind: 'item', id: 'unrelated', body: 'original-body', input: { authorityVersion: 'authority-a' } } }; s.model.operation = 'unknown'; s.render();
    const original = s.model.pending; s.request(); assert.equal(s.counts().navigations, 0);
    s.button('捨棄草稿並離開').props.onPress(); s.render(); assert.equal(s.counts().navigations, 1); assert.equal(s.model.pending, original); assert.equal(s.discarded.length, 1); assert.equal(s.dirtyKeys.size, 0);
  });
  test(`${kind} exact submitted payload survives workspace navigation but still protects child changes`, () => {
    const s = scenario(kind); s.edit(); s.submit(); assert.equal(s.counts().submitted, 1); const original = s.model.pending;
    s.request('child'); assert.equal(s.counts().navigations, 0); assert.equal(s.button('捨棄草稿並離開'), undefined);
    s.button('留在此頁查核').props.onPress(); s.render(); s.request(); assert.equal(s.counts().navigations, 1); assert.equal(s.model.pending, original); assert.deepEqual(s.discarded, []);
  });
}
test('topic enable operation does not consume independently selected context values in the same form', () => {
  const s = scenario('topic'); s.edit(); s.checkbox('我明確同意永久停用').props.onChange(true); s.render();
  s.button('確認永久停用主題').props.onPress(); s.render(); assert.equal(s.model.pending.attempt.input.action, 'set_enabled');
  s.request(); assert.equal(s.counts().navigations, 0); assert.ok(s.button('捨棄草稿並離開'));
});

test('manual concern text fields expose the same accessible names as their visible labels', () => {
  const s = scenario('manual');
  for (const label of ['關注名稱', '關注原因', '觀察內容']) assert.equal(s.host('TextField', label).props.accessibilityLabel, label);
});
