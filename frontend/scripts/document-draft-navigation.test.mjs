import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Actual document form and navigation guard, synthetic owner/field/host ports.
// The separate document owner suite verifies transport and frozen original requests.
function scenario(kind) {
  let visible = true, navigations = 0, submitted = 0, discards = 0, fieldValues, formId;
  const owner = { authorityVersion: 'authority-a', locked: false, dirty: false, epoch: 0, operation: { state: 'none' },
    markDraft() { owner.dirty = true; }, discardDraft() { if (!owner.retainedDraftId) { owner.dirty = false; owner.epoch++; discards++; } },
    createDocument() { submitted++; } };
  let nextId = 0;
  const mocks = {
    '../../theme': { colors: {}, spacing: {}, readingType: {}, typeScale: {} },
    'expo-router/react-navigation': { useNavigation: () => ({ dispatch() {} }), usePreventRemove() {} },
    'expo-router': { usePathname: () => '/growth', useRouter: () => ({ push() {} }), Link: 'Link' },
    'react-native': { View: 'View', Platform: { OS: 'android' }, StyleSheet: { create: value => value } },
    '../components/AppDialog': { AppDialog: Object.assign('Dialog', { Title: 'Title', Content: 'Content', Actions: 'Actions' }) },
    '../DateTimeFields': { AppDateField: 'DateField' }, '../AppCheckbox': { AppCheckbox: 'Checkbox' },
    '../FormErrorSummary': { FormErrorSummary: 'ErrorSummary', FormFieldMessage: 'FieldMessage' },
    '../ui': { AppButton: 'Button', AppSelect: 'Select', AppTextField: 'TextField' },
  };
  const h = harness(mocks);
  mocks.react = { ...h.react, useId: () => { const id = h.react.useRef(`guard-${++nextId}`).current; formId = id; return id; } };
  mocks['react-hook-form'] = {
    useForm: ({ defaultValues }) => {
      const state = h.react.useRef({ ...defaultValues }); fieldValues = state.current;
      return { control: state, reset: h.react.useCallback(values => { state.current = { ...values }; fieldValues = state.current; }, []),
        watch: name => state.current[name], setError() {}, setFocus() {}, formState: { errors: {} }, handleSubmit: callback => () => callback(state.current) };
    },
    Controller: ({ name, control, render }) => render({ field: { value: control.current[name], onChange: value => { control.current[name] = value; }, onBlur() {}, ref: null } }),
  };
  const guard = h.load('src/preview/PreviewNavigationGuard.tsx');
  const { DocumentCreateForm } = h.load('src/components/preparations/DocumentCreateForm.tsx');
  let leave;
  function RetainedOwner() { guard.usePreviewLeaveGuard(owner.dirty, owner.operation.state === 'saving' || !!owner.operation.recovery, 'child', undefined, true); return null; }
  function Page() { leave = guard.usePreviewNavigation(); return visible ? h.jsx(DocumentCreateForm, { owner, kind }) : null; }
  const tree = h.jsx(guard.PreviewNavigationGuard, { children: [h.jsx(RetainedOwner, {}, 'owner'), h.jsx(Page, {}, 'page')] });
  const render = () => h.render(tree);
  const button = label => h.hosts().find(node => node.type === 'Button' && node.props.label === label);
  const request = (intent = 'workspace') => { leave(() => { visible = false; navigations++; }, intent); render(); };
  render();
  return { h, owner, render, button, request, values: () => fieldValues, formId: () => h.hosts().find(node => node.type === 'TextField').props.nativeID.replace(/-title$/, ''), counts: () => ({ navigations, submitted, discards }),
    edit() { h.hosts().find(node => node.type === 'TextField').props.onChangeText('Synthetic unsent title'); render(); } };
}
for (const kind of ['preparation', 'growth_report']) {
  test(`${kind} local draft survives staying and only unmounts after explicit discard approval`, () => {
    const s = scenario(kind); s.edit(); s.request();
    assert.deepEqual(s.counts(), { navigations: 0, submitted: 0, discards: 0 });
    assert.ok(s.button('捨棄草稿並離開')); s.button('繼續編輯').props.onPress(); s.render();
    assert.equal(s.values().title, 'Synthetic unsent title'); assert.equal(s.owner.dirty, true);
    s.request(); s.button('捨棄草稿並離開').props.onPress(); s.render();
    assert.deepEqual(s.counts(), { navigations: 1, submitted: 0, discards: 1 }); assert.equal(s.owner.dirty, false);
  });
  test(`${kind} retained unknown may leave its workspace but remains protected on a child change`, () => {
    const s = scenario(kind); s.edit();
    s.owner.retainedDraftId = s.formId(); s.owner.operation = { state: 'unknown', recovery: 'check', reference: 'original-operation' }; s.owner.locked = true; s.render();
    s.request('child'); assert.ok(s.button('留在此頁查核')); assert.equal(s.button('捨棄草稿並離開'), undefined);
    s.button('留在此頁查核').props.onPress(); s.render();
    s.request('workspace'); assert.equal(s.counts().navigations, 1); assert.equal(s.counts().submitted, 0); assert.equal(s.counts().discards, 0);
    assert.equal(s.owner.operation.reference, 'original-operation'); assert.equal(s.owner.dirty, true);
  });
}

for (const kind of ['preparation', 'growth_report']) test(`${kind} unrelated document unknown never owns the local title draft`, () => {
  const s = scenario(kind); s.edit();
  s.owner.operation = { state: 'unknown', recovery: 'check', reference: 'other-document-operation' }; s.owner.locked = true; s.render();
  s.request(); assert.equal(s.counts().navigations, 0); assert.ok(s.button('捨棄草稿並離開'));
  s.button('繼續編輯').props.onPress(); s.render(); assert.equal(s.values().title, 'Synthetic unsent title');
  s.request(); s.button('捨棄草稿並離開').props.onPress(); s.render();
  assert.equal(s.counts().navigations, 1); assert.equal(s.counts().discards, 1); assert.equal(s.owner.dirty, false);
  assert.equal(s.owner.operation.reference, 'other-document-operation'); assert.equal(s.owner.operation.state, 'unknown');
});
