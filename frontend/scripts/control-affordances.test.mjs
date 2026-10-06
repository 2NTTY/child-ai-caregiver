import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let width = 1440;
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const native = {Platform: {OS: 'web', select: value => value.web ?? value.default}, StyleSheet: {create: value => value, flatten}, Pressable: 'Pressable', View: 'View', useWindowDimensions: () => ({width})};
const paper = {Button: 'PaperButton', Text: 'Text', TextInput: 'TextInput', Portal: 'Portal', RadioButton: {Item: 'RadioItem'}, MD3LightTheme: {colors: {}, fonts: {}}, configureFonts: value => value};
const react = {useId: () => 'test-disclosure', useState: value => [typeof value === 'function' ? value() : value, () => {}], useRef: value => ({current: value}), useLayoutEffect: () => {}};
const cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports: {}};
  const localRequire = name => name === 'react' ? react : name === 'react/jsx-runtime' ? require(name) : name === 'react-native' ? native : name === 'react-native-paper' ? paper
    : name === 'expo-router' ? {usePathname: () => '/'} : name.endsWith('/home-agent-entry') ? {homeAgentScope: () => 'test-child-scope'}
    : name.endsWith('/theme') ? load('src/theme.ts') : name.endsWith('/AppStatusBadge') ? load('src/components/AppStatusBadge.tsx')
    : name.endsWith('/summary-styles') ? load('src/components/summary/summary-styles.ts')
    : name.endsWith('/useInteractionDensity') ? {useInteractionDensity: () => false}
    : name.endsWith('/AppIcon') ? {AppIcon: 'AppIcon'} : new Proxy({}, {get: (_target, key) => String(key)});
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  cache.set(filename, module.exports);
  return module.exports;
}
const {AppButton, TextLink, OperationPill} = load('src/components/ui.tsx');
const {AppStatusBadge} = load('src/components/AppStatusBadge.tsx');
const {SummaryDisclosure} = load('src/components/summary/SummaryDisclosure.tsx');
const {HomeQuickActions} = load('src/components/HomeQuickActions.tsx');
const {contactRequestTones, contactAttemptTones, contactGrantStatus} = load('src/components/contact/contact-status.ts');
const {colors, mobileLayout} = load('src/theme.ts');

function contrast(a, b) {
  const lum = value => value.match(/[\da-f]{2}/gi).map(part => parseInt(part, 16) / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const values = [lum(a), lum(b)].sort((left, right) => right - left);
  return (values[0] + .05) / (values[1] + .05);
}

test('action variants use either a solid fill or a visible outline without a tinted fill', () => {
  for (const variant of ['primary', 'secondary', 'quiet', 'accent', 'danger', 'danger-secondary']) {
    const button = AppButton({label: '查看原始記錄', variant, onPress() {}});
    const style = flatten(button.props.style);
    assert.notEqual(button.props.mode, 'text', variant);
    if (button.props.mode === 'outlined') {
      assert.equal(button.props.buttonColor, 'transparent', variant);
      assert.match(style.borderColor, /^#[\da-f]{6}$/i);
      assert.ok(contrast(style.borderColor, colors.canvas) >= 3, variant);
    } else {
      assert.equal(style.borderWidth ?? 0, 0, variant);
      assert.equal(style.borderColor, undefined, variant);
    }
    assert.equal(button.props.accessibilityLabel, '查看原始記錄');
  }
  assert.equal(flatten(AppButton({label: '重新讀取', variant: 'quiet', onPress() {}}).props.style).alignSelf, 'flex-start');
  assert.equal(AppButton({label: '刪除', variant: 'danger-secondary', onPress() {}}).props.textColor, colors.errorInk);
  assert.equal(AppButton({label: '助手', variant: 'accent', onPress() {}}).props.buttonColor, colors.accent);
  assert.equal(AppButton({label: '確認刪除', variant: 'danger', onPress() {}}).props.buttonColor, colors.errorInk);
});

test('disabled actions preserve fill-or-outline treatment, readable text, and disabled semantics', () => {
  for (const variant of ['primary', 'secondary', 'quiet', 'accent', 'danger', 'danger-secondary']) {
    const button = AppButton({label: '下載 PDF（尚未接通）', variant, disabled: true, onPress() {}});
    const style = flatten(button.props.style);
    assert.equal(button.props.disabled, true);
    if (button.props.mode === 'outlined') {
      assert.equal(style.backgroundColor, 'transparent', variant);
      assert.equal(style.borderColor, colors.line);
      for (const surface of [colors.white, colors.canvas, colors.paleTeal]) assert.ok(contrast(button.props.theme.colors.onSurfaceDisabled, surface) >= 4.5);
    } else {
      assert.equal(style.backgroundColor, colors.softLine);
      assert.equal(style.borderWidth ?? 0, 0);
      assert.equal(style.borderColor, undefined);
      assert.ok(contrast(button.props.theme.colors.onSurfaceDisabled, colors.softLine) >= 4.5);
    }
  }
  assert.equal(AppButton({label: '讀取中', loading: true, onPress() {}}).props.disabled, true);
});

test('disclosures expose state and an adjacent chevron on the actual pressable', () => {
  for (const expanded of [false, true]) {
    let pressed = 0;
    const button = AppButton({label: '本次更新與版本', expanded, onPress() {pressed++;}});
    assert.equal(button.type, 'Pressable');
    assert.equal(button.props['aria-expanded'], expanded);
    assert.equal(button.props.accessibilityState.expanded, expanded);
    assert.equal(button.props.children[1].props.name, expanded ? 'chevron-up' : 'chevron-down');
    const style = flatten(button.props.style({pressed: false}));
    assert.equal(style.alignSelf, 'flex-start');
    assert.equal(style.backgroundColor, 'transparent');
    assert.equal(style.borderWidth, 1);
    const heldStyle = flatten(button.props.style({pressed: true}));
    assert.equal(heldStyle.backgroundColor, colors.pressedOverlay);
    assert.equal(heldStyle.opacity ?? 1, 1);
    assert.equal(heldStyle.borderWidth, style.borderWidth);
    assert.equal(heldStyle.borderColor, style.borderColor);
    assert.equal(typeof button.props.onFocus, 'function');
    assert.equal(typeof button.props.onBlur, 'function');
    button.props.onPress(); assert.equal(pressed, 1);
  }
  const disabled = AppButton({label: '詳情', expanded: false, disabled: true, onPress() {}});
  assert.equal(disabled.props['aria-disabled'], true);
  assert.equal(flatten(disabled.props.style({pressed: false})).backgroundColor, 'transparent');
  assert.equal(flatten(disabled.props.style({pressed: true})).backgroundColor, 'transparent');
});

test('home photo capture stays filled while its adjacent quick actions use outlines only', () => {
  const wrapper = HomeQuickActions({model: {children: [{id: 'child'}], selectedChildId: 'child', profileLoad: 'ready'}, actions: {}});
  const content = wrapper.type(wrapper.props);
  const [picker, secondary] = content.props.children[1].props.children;
  const camera = picker.props.renderTrigger({disabled: false, reading: false, onPress() {}});
  const captureStyle = flatten(camera.props.style({pressed: false}));
  assert.equal(captureStyle.backgroundColor, colors.accent);
  assert.equal(captureStyle.borderWidth ?? 0, 0);
  assert.equal(captureStyle.minHeight, 48);
  for (const button of secondary.props.children) {
    const style = flatten(button.props.style({pressed: false}));
    assert.equal(style.backgroundColor, 'transparent');
    assert.equal(style.borderWidth, 1);
    assert.equal(style.borderColor, colors.controlOutline);
    assert.equal(style.minHeight, 48);
    assert.equal(style.minWidth, 48);
  }
});

test('desktop compact and mobile controls retain their intended touch targets', () => {
  for (const testWidth of [1440, 1024, 390, 320]) {
    width = testWidth;
    const button = AppButton({label: '前往原始記錄', density: 'compact', variant: 'quiet', onPress() {}});
    assert.equal(flatten(button.props.contentStyle).minHeight, testWidth < mobileLayout.breakpoint ? 48 : 40);
    const disclosure = AppButton({label: '本次更新與版本', density: 'compact', expanded: false, onPress() {}});
    assert.equal(flatten(disclosure.props.style({pressed: false})).minHeight, testWidth < mobileLayout.breakpoint ? 48 : 40);
  }
  width = 1440;
});

test('summary disclosure width hugs its content and does not push its chevron to the far edge', () => {
  const disclosure = SummaryDisclosure({label: '核對睡眠的統計來源', scopeKey: 'child', children: 'Evidence'});
  const trigger = disclosure.props.children[0];
  const style = flatten(trigger.props.style({pressed: false}));
  assert.equal(style.alignSelf, 'flex-start');
  assert.equal(style.justifyContent, 'flex-start');
  assert.equal(style.maxWidth, '100%');
  assert.equal(style.gap, 8);
  assert.equal(style.backgroundColor, 'transparent');
  assert.equal(style.borderWidth, 1);
  assert.equal(flatten(trigger.props.children[0].props.style).flex, undefined);
  assert.equal(flatten(trigger.props.children[0].props.style).flexShrink, 1);
  assert.equal(trigger.props['aria-controls'], 'test-disclosure-content');
});

test('actual text links retain a visible underline', () => {
  const link = TextLink({label: '查看檔案', onPress() {}});
  assert.equal(flatten(link.props.children[0].props.style).textDecorationLine, 'underline');
});

test('status badges retain readable semantic text and do not rely on colour alone', () => {
  for (const tone of ['neutral', 'info', 'success', 'warning', 'error']) {
    const badge = AppStatusBadge({label: '結果待核對', tone});
    const style = flatten(badge.props.style);
    const [icon, label] = badge.props.children;
    assert.ok(icon.props.name);
    assert.equal(label.props.children, '結果待核對');
    assert.equal(flatten(label.props.style).flexShrink, 1);
    assert.ok(contrast(flatten(label.props.style).color, style.backgroundColor) >= 4.5, tone);
  }
  assert.equal(OperationPill({state: 'unknown'}).props.tone, 'warning');
  assert.equal(OperationPill({state: 'failed'}).props.tone, 'error');
  assert.equal(OperationPill({state: 'saved'}).props.tone, 'success');
});

test('contact channel acceptance remains distinct from receipt and unknown from failure', () => {
  assert.equal(contactRequestTones.accepted, 'info');
  assert.equal(contactAttemptTones.accepted, 'info');
  assert.equal(contactRequestTones.unknown, 'warning');
  assert.equal(contactAttemptTones.unknown, 'warning');
  assert.equal(contactRequestTones.rejected, 'error');
  assert.equal(contactAttemptTones.rejected, 'error');
});

test('grant badges preserve missing, revoked, expired, malformed and changed-version boundaries', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const grant = {enabled: true, taskVersion: 2, validUntil: '2026-10-06T12:00:00Z'};
  assert.equal(contactGrantStatus(undefined, 2, now).tone, 'neutral');
  assert.equal(contactGrantStatus({...grant, enabled: false}, 2, now).tone, 'neutral');
  assert.equal(contactGrantStatus(grant, 2, now).tone, 'info');
  for (const changed of [{...grant, validUntil: 'invalid'}, {...grant, validUntil: '2026-10-04T12:00:00Z'}, {...grant, taskVersion: 1}]) assert.equal(contactGrantStatus(changed, 2, now).tone, 'warning');
});

test('growth export requires an adapter and source conflicts stay warning states', () => {
  const archive = readFileSync(path.join(root, 'src/components/growth/GrowthArchive.tsx'), 'utf8');
  assert.ok(archive.includes('label="導出報告" variant="accent"'));
  assert.ok(archive.includes('testID="growth-report-export"'));
  assert.ok(archive.includes('const canExport = !!onExportReport && !!exportItem && !!growthReportExportRequest('));
  assert.ok(archive.includes('label={onExportReport ? "準備 PDF 報告" : "PDF 下載暫不可用"} disabled={!canExport} onPress={requestExport}'));
  assert.match(archive, /function requestExport\(\) \{\s*if \(!onExportReport \|\| !exportItem/);
  assert.ok(archive.includes('if (request) onExportReport(request);'));
  assert.ok(archive.includes('!onExportReport ? <View testID="growth-export-unavailable"'));
  assert.ok(archive.includes('報告生成及 PDF 下載暫未接通。'));
  assert.doesNotMatch(archive, /window\.print|createObjectURL|已(?:成功)?(?:匯出|導出|下載)/);
  const sources = readFileSync(path.join(root, 'src/components/shared-inputs/SourcesView.tsx'), 'utf8');
  assert.ok(sources.includes('label="版本衝突 · 待核對" tone="warning"'));
  assert.ok(!sources.includes('op.state === "conflict" ? "failed"'));
});
