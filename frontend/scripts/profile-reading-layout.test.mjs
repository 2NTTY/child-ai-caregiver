import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Actual page, reading projection, ManualFormDialog and leave guard. Layout/Modal
// hosts are bounded ports; pixel geometry and browser focus remain separate QA.
const data = { age: { kind: 'approximate', rawValue: '3', unit: 'years', asOf: '2026-10-07' }, dueDate: null, gestationalWeeksRaw: null,
  region: '合成香港', language: '合成廣東話', allergies: null, specialNeeds: null, preferences: null,
  source: '合成檔案來源', validUntil: null };
const revision = { version: 4, data, confirmedByLabel: '合成家長', confirmedAtLabel: '2026-10-07 14:00', reason: '合成更正原因' };
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
function scenario(width = 1024) {
  let dirty = false, pending = false, profile, record, reads = 0, histories = 0, discarded = 0, reviewed = 0, submits = 0, deleted = [], care = 0, focus = 0;
  const dialog = Object.assign('Dialog', { Title: 'Title', Content: 'Content', ScrollArea: 'ScrollArea', Actions: 'Actions' });
  const ui = { AppButton: 'Button', AppTextField: 'Field', SectionCard: 'Card', SectionHeader: 'Header', TextLink: 'Button' };
  const mocks = {
    'react-native': { View: 'View', Platform: { OS: 'android' }, StyleSheet: { create: x => x } },
    '../ui': ui, './ui': ui, '../components/ui': ui,
    '../theme': { colors: {}, spacing: {}, radius: {}, typeScale: {}, readingType: {} },
    '../../theme': { colors: {}, spacing: {}, radius: {}, typeScale: {}, readingType: {} },
    '../useContainerWidth': { useContainerWidth: () => ({ width, ref: { current: { getBoundingClientRect: () => ({ width }) } }, onLayout() {} }) },
    '../AppStatusBadge': { AppStatusBadge: 'Badge' }, '../StatusAnnouncement': { StatusAnnouncement: 'Announcement' },
    '../appearance/BackgroundSurface': { BackgroundSurface: 'View' }, '../components/PageFrame': { PageFrame: 'PageFrame' },
    '../components/OperationNotice': { OperationNotice: 'Notice' }, './ProfileForm': { ProfileForm: 'ProfileForm' },
    './AppDialog': { AppDialog: dialog }, '../components/AppDialog': { AppDialog: dialog }, './AppScrollView': { AppScrollView: 'ScrollView' },
    'expo-router/react-navigation': { useNavigation: () => ({}), usePreventRemove() {} },
    'expo-router': { usePathname: () => '/profile', useRouter: () => ({}), Link: 'Link' },
    '../production/CareProfileDomains': { useProductionCareProfile: () => ({ pending }) },
    '../production/useDomainEnvironment': { useDomainWriteGuard() {} },
    '../workspaces/ProfileWorkspace': { useProfileWorkspace: () => ({ model: profile, actions }) },
  };
  const h = harness(mocks); let id = 0;
  mocks.react = { ...h.react, useId: () => h.react.useRef(`profile-${++id}`).current };
  const motion = { MotionDisclosure: ({ expanded, children, ...props }) => h.jsx('Disclosure', { ...props, expanded, children: expanded ? children : null }),
    MotionReveal: ({ children, value }) => children(value) };
  mocks['../../motion'] = mocks['../motion'] = motion;
  const { emptyProfileForm } = h.load('src/profile-view-model.ts');
  profile = { child: { id: 'child-a', name: '合成小明' }, access: 'editable', online: true, reading: false, needsRefresh: false,
    current: revision, basis: revision, latest: null, history: [], historyOpen: false, hasMoreHistory: false,
    initialValues: emptyProfileForm(), formKey: 1, reviewedValues: null, intent: null, operation: { state: 'none', message: '', reference: null }, notice: null };
  record = { busy: null, childOutcome: 'draft', deletion: null, childName: '', childMessage: null };
  const actions = { refresh() { reads++; }, showHistory() { histories++; profile = { ...profile, historyOpen: true, history: [{ ...revision, version: 3 }] }; }, loadOlderHistory() {},
    editDraft() { dirty = true; }, reviewDraft() {}, discardDraft() { discarded++; dirty = false; }, cancelReview() { profile = { ...profile, intent: null, operation: { ...profile.operation, state: 'none' } }; },
    reviewDeletion() { reviewed++; profile = { ...profile, intent: 'delete', operation: { ...profile.operation, state: 'needs_confirmation' } }; }, submitReviewed() { submits++; }, useLatestVersion() {} };
  const guard = h.load('src/preview/PreviewNavigationGuard.tsx'), ProfilePage = h.load('src/screens/profileScreen.tsx').default;
  function Owner() { guard.usePreviewLeaveGuard(dirty, pending); return h.jsx(ProfilePage, {}); }
  let role = 'owner';
  const render = () => { h.production({ identityKey: 'parent-a', online: profile.online, recordsState: record,
    model: { children: [{ id: profile.child?.id ?? 'child-a', displayName: profile.child?.name ?? '合成小明', accessRole: role }], selectedChildId: profile.child?.id ?? 'child-a' },
    actions: { open() { care++; }, createChildPreview() {}, deleteChildPreview(id) { deleted.push(id); } },
    controller: { setChildName(value) { record = { ...record, childName: value }; } } });
    h.render(h.jsx(guard.PreviewNavigationGuard, { children: h.jsx(Owner, {}) })); };
  const button = label => h.hosts().find(x => x.type === 'Button' && x.props.label === label);
  const click = label => { const node = button(label); assert.ok(node, label); assert.ok(!node.props.disabled, `Enabled: ${label}`); node.props.onPress(); render(); };
  const copy = () => h.hosts().filter(x => ['Text', 'Header', 'Badge'].includes(x.type)).map(x => x.props.title ?? x.props.label ?? [x.props.children].flat(Infinity).filter(v => typeof v !== 'object').join('')).join('\n');
  render();
  return { h, button, click, copy, render, profile: () => profile, patch(value) { profile = { ...profile, ...value }; render(); },
    record(value) { record = { ...record, ...value }; render(); }, role(value) { role = value; render(); }, pending(value) { pending = value; render(); },
    focusTarget() { button('編輯檔案').props.ref.current = { isConnected: true, matches: () => true, focus() { focus++; } }; },
    web() { mocks['react-native'].Platform.OS = 'web'; }, counts: () => ({ reads, histories, discarded, reviewed, submits, deleted, care, focus }) };
}

test('reading first shows child identity, two solid grouped cards, and compact truthful unknown fields at all target widths', () => {
  for (const width of [1440, 1024, 390, 320]) {
    const s = scenario(width), text = s.copy();
    for (const value of ['合成小明', '基本資料', '健康與照顧', '約 3 歲（截至 2026-10-07）', '合成香港', '合成廣東話', '未知：預產期、出生孕週原文', '未知：過敏資料、特別需要、照顧偏好']) assert.ok(text.includes(value), value);
    assert.doesNotMatch(text, /合成檔案來源|合成更正原因|沒有過敏|沒有特別需要/);
    assert.equal(s.h.hosts().filter(x => x.type === 'Card').length, 2);
    assert.equal(flatten(s.h.node('profile-reading-groups').props.style).flexDirection, width < 640 ? 'column' : 'row');
    assert.ok(s.h.hosts().filter(x => x.type === 'Card').every(x => x.props.surface === undefined));
    if (width < 640) for (const card of s.h.hosts().filter(x => x.type === 'Card')) {
      const style = flatten(card.props.style);
      assert.equal(style.flexBasis, 'auto');
      assert.equal(style.flexGrow, 0); assert.equal(style.flexShrink, 0);
      assert.equal(style.height, undefined);
    }
    assert.equal(s.h.hosts().filter(x => x.type === 'ProfileForm').length, 0);
    assert.equal(s.button('刪除目前孩子'), undefined); assert.equal(s.button('確認及更正歷史'), undefined);
    assert.equal(s.h.hosts().filter(x => x.type === 'Button' && x.props.label === '編輯檔案').length, 1);
    assert.equal(s.h.hosts().find(x => x.type === 'PageFrame').props.title, '檔案');
  }
});

test('all known health/care values remain exact; no null is converted into an absence claim', () => {
  const s = scenario(); const exact = { ...data, allergies: '合成原文：花生？尚待核對', specialNeeds: '合成長文字\n保留換行', preferences: '合成照顧偏好' };
  s.patch({ current: { ...revision, data: exact } });
  for (const value of [exact.allergies, exact.specialNeeds, exact.preferences]) assert.ok(s.copy().includes(value));
  assert.doesNotMatch(s.copy(), /未知：過敏資料/);
  assert.equal(s.profile().current.data, exact);
});

test('profile details retain metadata but no history entry, reset on child change', () => {
  const s = scenario(); assert.equal(s.button('檔案詳情').props.expanded, false); s.click('檔案詳情');
  assert.equal(s.button('檔案詳情').props.expanded, true);
  for (const text of ['合成檔案來源', '合成更正原因', '合成家長', '2026-10-07 14:00', '資料有效至']) assert.ok(s.copy().includes(text));
  assert.ok(s.h.node('profile-revision-details')); assert.equal(s.counts().histories, 0);
  assert.equal(s.button('確認及更正歷史'), undefined); assert.equal(s.button('檔案詳情').props.accessibilityLabel, '檔案詳情');
  s.click('檔案詳情'); assert.equal(s.h.node('profile-revision-details'), undefined);
  s.click('檔案詳情'); assert.equal(s.counts().histories, 0);
  s.patch({ child: { id: 'child-b', name: '合成小晴' } }); assert.equal(s.button('檔案詳情').props.expanded, false);
});

test('profile editing keeps original confirmation, discard guard, and post-close exact trigger focus', () => {
  const s = scenario(); s.focusTarget(); s.click('編輯檔案');
  const form = s.h.hosts().find(x => x.type === 'ProfileForm'); assert.ok(form); form.props.onEdit(); s.render();
  s.click('關閉'); assert.ok(s.button('捨棄草稿並離開')); s.click('繼續編輯');
  assert.ok(s.h.hosts().find(x => x.type === 'ProfileForm')); assert.equal(s.counts().discarded, 0);
  s.click('關閉'); s.click('捨棄草稿並離開'); assert.equal(s.counts().discarded, 1);
  s.web(); s.h.node('manual-form-dialog').props.onClosed(); assert.equal(s.counts().focus, 1);
  s.click('編輯檔案'); s.click('永久刪除檔案及歷史'); assert.equal(s.counts().reviewed, 1); assert.equal(s.counts().submits, 0);
  assert.ok(s.button('確認永久刪除檔案及歷史')); s.click('取消刪除'); assert.equal(s.button('確認永久刪除檔案及歷史'), undefined);
});

test('unknown blocks close and writes, but preserves existing recovery and non-mutating details', () => {
  const s = scenario(); s.click('編輯檔案'); s.pending(true); s.patch({ operation: { state: 'unknown', message: '原操作未確認', reference: 'original-op' } });
  s.click('關閉'); assert.ok(s.button('留在此頁查核')); assert.equal(s.button('捨棄草稿並離開'), undefined);
  assert.equal(s.h.hosts().find(x => x.type === 'ProfileForm').props.editable, false);
  assert.equal(s.button('重新讀取檔案').props.disabled, true); assert.equal(s.counts().discarded, 0);
  s.click('留在此頁查核'); assert.ok(s.h.hosts().find(x => x.type === 'ProfileForm'));
});

test('child deletion stays secondary and forwards only to the original owner with every existing gate', () => {
  const s = scenario(); s.click('管理'); assert.equal(s.button('管理').props.expanded, true);
  assert.equal(s.button('刪除目前孩子').props.accessibilityLabel, '永久刪除目前孩子及其資料');
  s.click('刪除目前孩子'); assert.deepEqual(s.counts().deleted, ['child-a']); assert.equal(s.counts().submits, 0);
  for (const change of [{ busy: 'createChild' }, { busy: null, childOutcome: 'unknown' }, { childOutcome: 'checked' }, { childOutcome: 'draft', deletion: { phase: 'unknown' } }]) {
    s.record(change); assert.equal(s.button('刪除目前孩子').props.disabled, true);
  }
  s.record({ deletion: null }); s.patch({ online: false }); assert.equal(s.button('刪除目前孩子').props.disabled, true);
  s.patch({ online: true, operation: { state: 'conflict' } }); assert.equal(s.button('刪除目前孩子').props.disabled, true);
  s.role('viewer'); assert.equal(s.button('管理'), undefined); assert.equal(s.button('刪除目前孩子'), undefined);
  s.patch({ access: 'read_only' }); assert.equal(s.button('編輯檔案'), undefined);
  s.patch({ access: 'lost' }); assert.doesNotMatch(s.copy(), /合成檔案來源|基本資料|健康與照顧/);
});

test('only the requested dynamic History description is removed; category descriptions remain owned by their category', () => {
  const source = readFileSync(new URL('../src/screens/historyScreen.tsx', import.meta.url), 'utf8');
  assert.ok(!source.includes('分類回看${childName}的過往資料，從原始來源查看詳情。'));
  assert.match(source, /<PageFrame density="compact" title="歷史" scrollRef=/);
  assert.match(source, /current\.description/);
  assert.match(source, /description="按分類查閱過往資料。"/);
});
