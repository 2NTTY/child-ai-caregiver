import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

test('the actual navigation guard cancels reveal intents and unrelated route visits discard unconsumed requests', () => {
  let dirty = false, pending = false, pathname = '/tasks', request, hints;
  const routes = [];
  const dialog = Object.assign('Dialog', { Title: 'Title', ScrollArea: 'ScrollArea', Content: 'Content', Actions: 'Actions' });
  const mocks = {
    'react-native': { View: 'View', Platform: { OS: 'android' }, StyleSheet: { create: x => x } },
    'react-native-paper': { Text: 'Text', Portal: ({ children }) => children },
    './AppDialog': { AppDialog: dialog }, '../components/AppDialog': { AppDialog: dialog },
    'expo-router/react-navigation': { useNavigation: () => ({ dispatch() {} }), usePreventRemove() {} },
    'expo-router': { usePathname: () => pathname, useRouter: () => ({ push: path => { routes.push(path); pathname = path; } }), Link: 'Link' },
    '../workspaces/CareWorkspace': { useCareWorkspace: () => null }, '../workspaces/ProfileWorkspace': { useProfileWorkspace: () => null },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => null }, '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => null },
    '../workspaces/PreparationWorkspace': { usePreparationWorkspace: () => null },
    './SettingsDomains': { useProductionContactDomain: () => ({ model: {} }), useProductionSettingsDomains: () => ({ modelSettings: { model: {} } }) },
  };
  const h = harness(mocks);
  mocks.react = { ...h.react, useId: () => h.react.useRef('synthetic-guard').current, useSyncExternalStore: (_subscribe, get) => get() };
  const guard = h.load('src/preview/PreviewNavigationGuard.tsx');
  const { useHeaderOperationHints } = h.load('src/production/useHeaderOperationHints.ts');
  const { useOperationReveal } = h.load('src/operation-reveal.ts');
  h.production({ scopeKey: 'child-a', identityKey: 'synthetic-parent', model: { operation: { state: 'unknown' } } });
  function Probe() {
    guard.usePreviewLeaveGuard(dirty, pending);
    hints = useHeaderOperationHints(); request = useOperationReveal('synthetic-parent', 'create-child'); return null;
  }
  const tree = h.jsx(guard.PreviewNavigationGuard, { children: h.jsx(Probe) });
  const render = () => h.render(tree), button = label => h.hosts().find(node => node.type === 'Button' && node.props.label === label);
  render(); dirty = true; render(); hints[0].onReview(); render();
  assert.ok(button('繼續編輯')); button('繼續編輯').props.onPress(); render();
  assert.deepEqual(routes, []); assert.equal(request, undefined);
  dirty = false; pathname = '/guide'; render(); assert.equal(request, undefined, 'ordinary navigation after cancellation never opens a form');
  pathname = '/tasks'; pending = true; render(); hints[0].onReview(); render();
  assert.ok(button('留在此頁')); button('留在此頁').props.onPress(); render();
  assert.deepEqual(routes, []); assert.equal(request, undefined);
  pending = false; dirty = true; render(); hints[0].onReview(); render(); button('捨棄並離開').props.onPress(); render();
  assert.deepEqual(routes, ['/guide']); assert.ok(request);
  // Simulate leaving before the target form has mounted or consumed its intent.
  pathname = '/settings'; render(); pathname = '/guide'; render();
  assert.equal(request, undefined, 'returning to the target must not replay an abandoned reveal');
});
