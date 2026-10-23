import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Shallow source rendering: real page, panel and frame functions; no browser or owner writes.
const jsx = (type, props) => ({ type, props });
const elements = new Proxy({}, { get: (_target, key) => String(key) });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : !value || typeof value !== 'object' ? [] : [value, ...nodes(value.props?.children)];
const content = value => Array.isArray(value) ? value.map(content).join(' ') : value == null || value === false ? '' : typeof value === 'object' ? content(value.props?.children) : String(value);

function harness(section = 'children') {
  const theme = { colors: {}, radius: {}, spacing: {}, readingType: {}, mobileIcons: {}, mobileType: {}, workspaceType: {}, typeScale: {}, mobileLayout: { breakpoint: 650 } };
  const hooks = { useState: initial => [initial, () => {}], useRef: current => ({ current }), useId: () => 'synthetic-settings-tabs', useEffect() {}, useLayoutEffect() {} };
  let ui, frame;
  function load(relative) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    const result = ts.transpileModule(source, { fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
    assert.equal(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputText)(name => {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 390 }) };
      if (name === 'react-native-paper') return { Text: 'Text', Divider: 'Divider' };
      if (name === 'expo-router') return { useLocalSearchParams: () => ({ section }) };
      if (name.endsWith('/theme')) return theme;
      if (name.endsWith('/ui')) return ui;
      if (name.endsWith('/PageFrame')) return { PageFrame: frame };
      if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 390, ref: null, onLayout() {} }) };
      if (name.endsWith('/useInteractionDensity')) return { useInteractionDensity: () => false };
      if (name.endsWith('/BackgroundSurface')) return { BackgroundSurface: 'BackgroundSurface', useCustomBackground: () => false };
      if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewNavigation: () => action => action() };
      if (name.endsWith('/ProductionFirstScreenGate')) return { useProductionVisibleSettingsSection() {} };
      if (name.endsWith('/SettingsDomains')) return { useProductionSettingsDomains: () => ({ modelSettings: { model: {}, actions: {} } }), ProductionChannelSettings: 'ProductionChannelSettings', ProductionNotificationPreferences: 'ProductionNotificationPreferences' };
      if (name.endsWith('/ProductionProvider')) return { useProduction: () => ({
        model: { children: [{ id: 'synthetic-child', displayName: '合成孩子', ageLabel: '4 歲', profileConfirmed: true }] },
        actions: {}, user: { name: '合成本人', email: 'synthetic@example.invalid' }, scopeKey: 'synthetic-scope', authorization: {},
        signOut() {}, recordsState: { childrenLoadedAt: 'synthetic-read' }, online: true,
      }) };
      return elements;
    }, module, module.exports);
    return module.exports;
  }
  ui = load('../src/components/ui.tsx');
  frame = load('../src/components/PageFrame.tsx').PageFrame;
  return { ui, frame, settings: () => load('../src/screens/settingsScreen.tsx').default() };
}

test('settings removes selected-tab headings but preserves availability, scope and privacy content', () => {
  for (const section of ['children', 'family', 'privacy']) {
    const h = harness(section), page = h.settings(), all = nodes(page);
    const navigation = all.find(node => node.type === 'SettingsNavigation');
    assert.deepEqual(navigation.props.items.map(item => item.key), ['account', 'children', 'family', 'preferences', 'notifications', 'assistant', 'model', 'privacy']);
    const panel = all.find(node => node.type === h.ui.AppTabPanel && node.props.tabKey === section);
    assert.equal(panel.props.active, true); assert.equal(panel.props.tabsId, navigation.props.id);
    const rendered = h.ui.AppTabPanel(panel.props);
    assert.equal(rendered.props.role, 'tabpanel'); assert.equal(rendered.props.tabIndex, 0);
    assert.equal(rendered.props['aria-labelledby'], `synthetic-settings-tabs-tab-${section}`);
    assert.equal(rendered.props['aria-hidden'], false);
    if (section === 'children') {
      assert.equal(nodes(panel).some(node => node.type === h.ui.SectionHeader), false);
      assert.match(content(panel), /合成孩子/); assert.match(content(page), /可存取的孩子/);
    } else if (section === 'family') {
      assert.equal(nodes(panel).some(node => node.type === h.ui.SectionHeader), false);
      assert.match(content(panel), /家庭協作尚未開放。本人聯絡與授權仍可管理。/);
      assert.ok(nodes(panel).some(node => node.props?.label === '聯絡'));
    } else {
      assert.deepEqual(nodes(panel).filter(node => node.type === h.ui.SectionHeader).map(node => node.props.title), ['私隱', '來源', '帳戶操作']);
      assert.match(content(panel), /完整來源保持本人私人；共享照護記錄須另行確認/);
    }
  }
});

test('page names stay available to assistive technology without empty introduction containers', () => {
  const { frame } = harness();
  for (const title of ['記憶', '全部功能', '設定']) {
    const page = frame({ title, children: jsx('Content', { children: 'Synthetic content' }) });
    assert.equal(page.props.role, 'region'); assert.equal(page.props.accessibilityLabel, title);
    assert.equal(page.props.tabIndex, -1);
    assert.deepEqual(page.props.dataSet, { pageSurface: 'true' });
    assert.equal(nodes(page).filter(node => node.type === 'BackgroundSurface').length, 1);
    assert.equal(content(page), ' Synthetic content');
  }
});
