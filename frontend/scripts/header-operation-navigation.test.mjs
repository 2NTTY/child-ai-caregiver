import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

test('public operation owners supply exact scoped page targets, guarded navigation and one-shot original-form reveal', () => {
  const scope = 'synthetic-parent:child-a', identity = 'synthetic-parent';
  const routes = [], approvals = [];
  const workspace = state => ({ scopeKey: scope, model: { access: 'editable', operation: { state } } });
  const care = workspace('needs_confirmation'), profile = workspace('needs_confirmation'), tasks = workspace('failed');
  const growth = { scopeKey: scope, model: { access: 'editable', operation: 'unknown' } };
  const preparation = { ...workspace('unknown'), recovery: {} };
  const contact = { model: { scopeKey: scope, access: 'editable', operation: 'conflict' } };
  const settings = { modelSettings: { model: { scopeKey: identity, authorized: true, operation: 'failed' } } };
  const mocks = {
    'expo-router': { usePathname: () => '/guide', useRouter: () => ({ push: path => routes.push(path) }) },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => action => approvals.push(action) },
    '../workspaces/CareWorkspace': { useCareWorkspace: () => care }, '../workspaces/ProfileWorkspace': { useProfileWorkspace: () => profile },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => tasks }, '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => growth },
    '../workspaces/PreparationWorkspace': { usePreparationWorkspace: () => preparation },
    './SettingsDomains': { useProductionContactDomain: () => contact, useProductionSettingsDomains: () => settings },
  };
  const h = harness(mocks);
  mocks.react = { ...h.react, useSyncExternalStore: (_subscribe, get) => get() };
  const { useHeaderOperationHints } = h.load('src/production/useHeaderOperationHints.ts');
  const { navigationItems } = h.load('src/components/navigation/app-navigation.ts');
  const { useOperationReveal } = h.load('src/operation-reveal.ts');
  let hints, childRequest, profileRequest;
  const production = { scopeKey: scope, identityKey: identity, model: { operation: { state: 'unknown' } } };
  h.production(production);
  function Probe() {
    hints = useHeaderOperationHints(); childRequest = useOperationReveal(production.identityKey, 'create-child');
    profileRequest = useOperationReveal(production.scopeKey, 'profile'); return null;
  }
  const render = () => h.render(h.jsx(Probe)); render();
  assert.deepEqual(hints.map(hint => hint.id), ['create-child', 'care', 'profile', 'tasks', 'growth', 'preparation', 'contact', 'model-settings']);
  assert.equal(navigationItems.care.short, '核對');
  assert.deepEqual(hints.map(hint => hint.page), ['建立孩子', navigationItems.care.short, navigationItems.profile.short,
    navigationItems.tasks.short, navigationItems.growth.short, '準備單', navigationItems.contact.short, '模型設定'],
    'Header hints use the real destination labels while retaining specific operation and section names');
  const expected = ['/guide', '/care', '/profile', '/tasks', '/growth?tab=concerns', '/growth?tab=preparation', '/contact', '/settings?section=model'];
  for (const [index, hint] of hints.entries()) { hint.onReview(); assert.equal(routes.length, index, 'navigation waits for the existing guard'); approvals.shift()(); }
  assert.deepEqual(routes, expected); render(); assert.equal(profileRequest.scopeKey, scope);
  profileRequest.consume(); render(); assert.equal(profileRequest, undefined);
  hints[0].onReview(); approvals.shift()(); render(); assert.equal(childRequest.scopeKey, identity);
  childRequest.consume(); render(); assert.equal(childRequest, undefined);
  const staleHint = hints.find(hint => hint.id === 'profile'); staleHint.onReview(); const delayed = approvals.shift();
  production.scopeKey = 'synthetic-parent:child-b'; render(); delayed(); staleHint.onReview();
  assert.equal(routes.length, 9); assert.equal(approvals.length, 0); assert.equal(profileRequest, undefined);
  assert.deepEqual(hints.map(hint => hint.id), ['create-child', 'model-settings'], 'old child projections are synchronously excluded');
  production.identityKey = 'other-synthetic-parent'; production.model.operation.state = 'none'; render();
  assert.equal(hints.length, 0); assert.equal(childRequest, undefined);
});
