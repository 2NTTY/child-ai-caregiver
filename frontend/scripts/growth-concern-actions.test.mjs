import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Real local action component and React-state lifecycle with synthetic native hosts.
// Browser dimensions, keyboard focus and pixels require the preview acceptance pass.
test('management opens locally without remounting its original controls or hiding the direct manual entry', () => {
  const mocks = {
    'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value } },
    '../../theme': { colors: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, radius: { small: 12 }, typeScale: {}, readingType: { tool: { fontSize: 14 } }, workspaceType: {} },
    '../../motion': { MotionDisclosure: 'MotionDisclosure' },
    '../AppIcon': { AppIcon: 'AppIcon' },
  };
  const h = harness(mocks);
  mocks.react = { ...h.react, useId: () => 'synthetic-actions' };
  const { GrowthConcernActions } = h.load('src/components/growth/GrowthConcernActions.tsx');
  let mounts = 0, unmounts = 0, scopeKey = 'child-a', hasManagement = true;
  function OriginalControl() {
    h.react.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return h.jsx('OriginalControl', {});
  }
  function Page() { return h.jsx(GrowthConcernActions, { scopeKey, hasManagement, primary: h.jsx('ManualEntry', {}), children: h.jsx(OriginalControl, {}) }); }
  const render = () => h.render(h.jsx(Page, {}));
  const trigger = () => h.hosts().find(node => node.type === 'Pressable');
  const disclosure = () => h.hosts().find(node => node.type === 'MotionDisclosure');
  render();
  assert.equal(trigger().props.accessibilityLabel, '管理關注');
  assert.equal(trigger().props['aria-expanded'], false);
  assert.equal(trigger().props['aria-controls'], disclosure().props.nativeID);
  assert.equal(disclosure().props.expanded, false);
  const row = h.node('growth-concern-actions').props.children[0];
  assert.equal(row.props.children[0].type, 'ManualEntry');
  assert.equal(row.props.style.flexDirection, 'row');
  assert.equal(row.props.style.alignItems, 'center');
  assert.equal(row.props.style.gap, 8);
  assert.equal(h.node('growth-concern-management-menu').props.style.alignSelf, 'flex-start');
  assert.equal(h.node('growth-concern-management-menu').props.style.maxWidth, '100%');
  trigger().props.onPress(); render();
  assert.equal(disclosure().props.expanded, true);
  assert.equal(trigger().props['aria-expanded'], true);
  trigger().props.onPress(); render();
  assert.equal(disclosure().props.expanded, false);
  trigger().props.onPress(); render();
  assert.equal(disclosure().props.expanded, true);
  assert.equal(mounts, 1); assert.equal(unmounts, 0);
  scopeKey = 'child-b'; render();
  assert.equal(disclosure().props.expanded, false, 'A different child never inherits an open management panel');
  assert.equal(disclosure().props.scopeKey, 'child-b');
  hasManagement = false; render();
  assert.equal(trigger(), undefined);
  assert.equal(disclosure().props.expanded, false);
  assert.ok(h.hosts().some(node => node.type === 'ManualEntry'));
});
