import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const native = { Platform: { OS: 'web', select: value => value.web ?? value.default }, StyleSheet: { create: value => value, flatten }, Pressable: 'Pressable', View: 'View', useWindowDimensions: () => ({ width: 1440 }) };
const paper = { Button: 'PaperButton', Text: 'Text', TextInput: 'TextInput', RadioButton: { Item: 'RadioItem' }, Portal: 'Portal', MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: value => value };
const react = { useState: value => [value, () => {}], useRef: value => ({ current: value }), useLayoutEffect() {} };
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const output = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputText)(name => name === 'react' ? react : name === 'react/jsx-runtime' ? require(name)
    : name === 'react-native' ? native : name === 'react-native-paper' ? paper : name.endsWith('/theme') ? load('src/theme.ts')
      : name.startsWith('lucide-react-native/icons/') ? { __esModule: true, default: name }
      : name.endsWith('/useInteractionDensity') ? { useInteractionDensity: () => false } : new Proxy({}, { get: (_target, key) => String(key) }), module, module.exports);
  cache.set(file, module.exports); return module.exports;
}
const { AppButton } = load('src/components/ui.tsx');
const { colors, paperTheme } = load('src/theme.ts');
const variants = ['primary', 'danger', 'secondary', 'quiet', 'accent', 'danger-secondary'];

test('only primary and danger AppButton roles override Paper ripple colour', () => {
  for (const variant of variants) {
    const onPress = () => {};
    const button = AppButton({ label: '確認', variant, onPress });
    assert.equal(button.type, 'PaperButton');
    assert.equal(button.props.rippleColor, variant === 'primary' || variant === 'danger' ? colors.darkActionRipple : undefined, variant);
    assert.equal(button.props.onPress, onPress); assert.equal(button.props.accessibilityLabel, '確認');
    assert.equal(flatten(button.props.contentStyle).minHeight, 44);
  }
  assert.equal(AppButton({ label: '預設主操作', onPress() {} }).props.rippleColor, colors.darkActionRipple);
  const disclosure = AppButton({ label: '詳情', expanded: false, onPress() {} });
  assert.equal(disclosure.type, 'Pressable'); assert.equal(disclosure.props.rippleColor, undefined);
});

test('dark action ripple keeps filled backgrounds, white text and existing unavailable states', () => {
  for (const variant of ['primary', 'danger']) {
    const button = AppButton({ label: '確認', variant, onPress() {} });
    assert.equal(button.props.mode, 'contained');
    assert.equal(button.props.buttonColor ?? paperTheme.colors.primary, variant === 'danger' ? colors.errorInk : colors.ink);
    assert.equal(button.props.textColor ?? paperTheme.colors.onPrimary, colors.white);
    assert.equal(flatten(button.props.style).borderWidth ?? 0, 0);
    for (const state of [{ disabled: true }, { loading: true }]) {
      const unavailable = AppButton({ label: '等待', variant, ...state, onPress() {} });
      assert.equal(unavailable.props.disabled, true);
      assert.equal(unavailable.props.loading, !!state.loading);
      assert.equal(flatten(unavailable.props.style).backgroundColor, colors.softLine);
      assert.equal(unavailable.props.theme.colors.onSurfaceDisabled, colors.muted);
      assert.equal(unavailable.props.rippleColor, colors.darkActionRipple);
    }
  }
  assert.equal(paperTheme.colors.onSurface, colors.ink, 'no global onSurface change');
});

test('destructive actions share vivid red, an explicit label and a decorative warning icon', () => {
  assert.equal(colors.errorInk, '#D61F26');
  assert.equal(colors.coral, colors.errorInk);
  assert.equal(colors.statusFailedLine, colors.errorInk);
  assert.equal(colors.paleCoral, '#FEF2F2');
  assert.equal(paperTheme.colors.error, colors.errorInk);
  assert.equal(paperTheme.colors.errorContainer, colors.paleCoral);
  for (const variant of ['danger', 'danger-secondary']) {
    const button = AppButton({ label: '確認永久刪除帳戶', variant, onPress() {} });
    assert.equal(button.props.children, '確認永久刪除帳戶');
    assert.equal(button.props.accessibilityLabel, '確認永久刪除帳戶');
    const icon = button.props.icon({ color: variant === 'danger' ? colors.white : colors.errorInk, size: 18 });
    assert.equal(icon.props.name, 'alert-outline');
    assert.equal(icon.props.importantForAccessibility, 'no');
    if (variant === 'danger-secondary') {
      assert.equal(button.props.mode, 'outlined');
      assert.equal(button.props.buttonColor, 'transparent');
      assert.equal(button.props.textColor, colors.errorInk);
      assert.equal(flatten(button.props.style).borderColor, colors.errorInk);
    }
    for (const state of [{ disabled: true }, { loading: true }]) {
      const unavailable = AppButton({ label: '確認永久刪除帳戶', variant, ...state, onPress() {} });
      assert.equal(unavailable.props.disabled, true);
      assert.equal(unavailable.props.loading, !!state.loading);
      assert.equal(unavailable.props.theme.colors.onSurfaceDisabled, colors.muted);
      const disabledIcon = unavailable.props.icon({ color: colors.muted, size: 18 });
      assert.equal(disabledIcon.props.color, colors.muted, 'icon follows Paper disabled colour');
      assert.equal(flatten(unavailable.props.style).backgroundColor, variant === 'danger' ? colors.softLine : 'transparent');
      if (variant === 'danger-secondary') assert.equal(flatten(unavailable.props.style).borderColor, colors.line);
    }
  }
  for (const variant of ['primary', 'secondary', 'quiet', 'accent']) {
    assert.equal(AppButton({ label: '取消', variant, onPress() {} }).props.icon, undefined);
  }
});

const rgb = value => value.slice(1).match(/../g).map(channel => parseInt(channel, 16));
const composite = (foreground, background, alpha) => foreground.map((channel, i) => channel * alpha + background[i] * (1 - alpha));
const luminance = value => value.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); };

test('destructive red is readable on filled, outlined and pale error surfaces', () => {
  assert.ok(contrast(rgb(colors.white), rgb(colors.errorInk)) >= 4.5);
  for (const surface of ['white', 'canvas', 'paleTeal', 'paleCoral']) {
    assert.ok(contrast(rgb(colors.errorInk), rgb(colors[surface])) >= 4.5, surface);
  }
});

test('the shared warning icon resolves to a hidden decorative triangle rather than a deletion-only symbol', () => {
  assert.ok(require.resolve('lucide-react-native/icons/triangle-alert'));
  const { AppIcon } = load('src/components/AppIcon.tsx');
  const icon = AppIcon({ name: 'alert-outline', size: 18, color: colors.errorInk, importantForAccessibility: 'no' });
  assert.equal(icon.props['aria-hidden'], true);
  assert.equal(icon.props.accessible, false);
  assert.equal(icon.props.importantForAccessibility, 'no');
  assert.equal(icon.props.children.type, 'lucide-react-native/icons/triangle-alert');
  assert.equal(icon.props.children.props['aria-hidden'], true);
  assert.equal(icon.props.children.props.focusable, false);
});

test('Paper hover and held ripple darken both action surfaces with readable contrast', () => {
  const match = colors.darkActionRipple.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
  assert.ok(match); const shade = match.slice(1, 4).map(Number), alpha = Number(match[4]);
  assert.deepEqual(shade, [0, 0, 0]); assert.equal(alpha, .12);
  // Installed Paper 5.15.3 halves ripple alpha for hover; its ripple overlays that surface.
  const hoverAlpha = alpha * .5;
  for (const name of ['ink', 'errorInk']) {
    const background = rgb(colors[name]), text = rgb(colors.white);
    const hover = composite(shade, background, hoverAlpha);
    const held = composite(shade, hover, alpha);
    assert.ok(luminance(hover) < luminance(background), name);
    assert.ok(luminance(held) < luminance(hover), name);
    assert.ok(contrast(text, hover) >= 4.5, `${name}: hover contrast`);
    // Conservative bound also shades the text by both layers, although hover is behind it.
    const conservativeText = composite(shade, composite(shade, text, hoverAlpha), alpha);
    assert.ok(contrast(conservativeText, held) >= 4.5, `${name}: held contrast`);
  }
});
