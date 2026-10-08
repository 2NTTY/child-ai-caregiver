import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const source = file => ts.createSourceFile(file, readFileSync(new URL(file, root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function collect(node, predicate) {
  const found = [];
  function visit(current) { if (predicate(current)) found.push(current); ts.forEachChild(current, visit); }
  visit(node); return found;
}
function moduleFrom(file, dependencies) {
  const output = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputText)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const theme = moduleFrom('src/theme.ts', {
  'react-native': { Platform: { OS: 'web', select: value => value.web } },
  'react-native-paper': { MD3LightTheme: { colors: {}, fonts: {}, animation: {} }, configureFonts: value => value },
});
const chat = moduleFrom('src/components/chat/chat-presentation.ts', {
  'react-native': { Platform: { OS: 'web', select: value => value.web } }, '../../theme': theme,
});
const context = { ...theme, ...chat, homeAvatarSize: 48, homeArrowSize: 20 };
function expression(text, values = {}) {
  const ctx = { ...context, ...values };
  const output = ts.transpileModule(`export const result = (${text});`, {
    fileName: 'state-style.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function(...Object.keys(ctx), 'require', 'module', 'exports', output.outputText)(...Object.values(ctx), require, module, module.exports);
  return module.exports.result;
}
function styles(file, binding = 'styles') {
  const sf = source(file);
  const declaration = collect(sf, node => ts.isVariableDeclaration(node) && node.name.getText(sf) === binding)[0];
  assert.ok(declaration && ts.isCallExpression(declaration.initializer), `${file}: missing ${binding}`);
  return expression(declaration.initializer.arguments[0].getText(sf));
}
function attribute(node, name, sf) {
  return node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(sf) === name)?.initializer;
}
function control(file, matcher) {
  const sf = source(file);
  const nodes = collect(sf, node => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node));
  const result = nodes.find(node => matcher(node, sf));
  assert.ok(result, `${file}: missing control`); return { node: result, sf };
}
const named = label => (node, sf) => attribute(node, 'accessibilityLabel', sf)?.getText(sf) === JSON.stringify(label);
const usesStyle = name => (node, sf) => attribute(node, 'style', sf)?.getText(sf).includes(name);
function stateStyle(file, matcher, values = {}, state = { pressed: true }) {
  const { node, sf } = control(file, matcher), style = attribute(node, 'style', sf);
  assert.ok(style && ts.isJsxExpression(style));
  const callback = expression(style.expression.getText(sf), values);
  return flatten(typeof callback === 'function' ? callback(state) : callback);
}
const opaque = style => assert.equal(style.opacity ?? 1, 1, 'enabled press must retain whole-control opacity');

// These are the former fade definitions, not a ban on disabled or content animation opacity.
const formerFadeStyles = {
  'src/components/AppCheckbox.tsx': ['pressed'], 'src/components/AppShell.tsx': ['pressed'],
  'src/components/ChildPicker.tsx': ['homePressed'], 'src/components/HomeAgentImportant.tsx': ['pressed'],
  'src/components/HomeDashboard.tsx': ['pressed'], 'src/components/HomeOverviewItems.tsx': ['pressed'],
  'src/components/HomeQuickActions.tsx': ['pressed'], 'src/components/RightRailContent.tsx': ['pressed'],
  'src/components/agent/AgentComposer.tsx': ['pressed'], 'src/components/agent/AgentConversationPreview.tsx': ['pressed'],
  'src/components/care/CareReviewHistoryView.tsx': ['pressed'], 'src/components/chat/AnswerSources.tsx': ['pressed'],
  'src/components/chat/ChatMessage.tsx': ['pressed'], 'src/components/contact/contact-styles.ts': ['pressed'],
  'src/components/growth/GrowthHistoryView.tsx': ['readPressed'], 'src/components/growth/growth-styles.ts': ['pressed'],
  'src/components/settings/SettingsNavigation.tsx': ['pressed'], 'src/components/summary/summary-styles.ts': ['pressed'],
  'src/components/tasks/TaskListRow.tsx': ['pressed'], 'src/components/tasks/TasksCalendar.tsx': ['pressed'],
  'src/components/tasks/TasksView.tsx': ['pressed'], 'src/components/ui.tsx': ['buttonPressed', 'linkPressed'],
  'src/screens/guideScreen.tsx': ['pressed'], 'src/screens/loginScreen.tsx': ['pressed'],
  'src/screens/profileScreen.tsx': ['pressed'], 'src/screens/settingsScreen.tsx': ['pressed'],
};
test('all 27 former enabled press fades retain opacity and provide local surface feedback', () => {
  let count = 0;
  for (const [file, keys] of Object.entries(formerFadeStyles)) {
    const sf = source(file);
    for (const key of keys) {
      const prop = collect(sf, node => ts.isPropertyAssignment(node) && node.name.getText(sf) === key && ts.isObjectLiteralExpression(node.initializer))[0];
      assert.ok(prop, `${file}: ${key}`);
      const value = expression(prop.initializer.getText(sf)); opaque(value);
      assert.ok(value.backgroundColor, `${file}: ${key} retains feedback`);
      assert.equal(value.borderWidth, undefined, 'feedback must not add a frame'); count++;
    }
  }
  assert.equal(count, 27);
});
test('selection fields, options, tabs and lightweight links keep distinct resting roles', () => {
  const file = 'src/components/ui.tsx', shared = styles(file);
  const field = { styles: shared, compact: false, touch: false, disabled: false };
  const normal = stateStyle(file, usesStyle('styles.selectionTrigger'), field, { pressed: false });
  const pressed = stateStyle(file, usesStyle('styles.selectionTrigger'), field); opaque(pressed);
  assert.equal(normal.backgroundColor, theme.colors.controlSurface);
  assert.equal(pressed.backgroundColor, theme.colors.paleTeal);
  assert.equal(pressed.borderWidth, normal.borderWidth);
  assert.equal(pressed.minHeight, normal.minHeight);
  const disabled = stateStyle(file, usesStyle('styles.selectionTrigger'), { ...field, disabled: true });
  assert.equal(disabled.opacity, .5); assert.equal(disabled.backgroundColor, normal.backgroundColor);
  opaque(stateStyle(file, usesStyle('styles.countedOption'), { styles: shared, disabled: false }));
  const link = stateStyle(file, usesStyle('styles.link,'), { styles: shared, compact: false, touch: false });
  opaque(link); assert.equal(link.borderWidth, undefined); assert.equal(link.backgroundColor, theme.colors.pressedOverlay);
  const tab = stateStyle(file, usesStyle('styles.tab,'), { styles: shared, compact: false, touch: false, selection: null, value: 'one', item: { key: 'one' } });
  opaque(tab); assert.equal(tab.borderBottomColor, theme.colors.teal); assert.equal(tab.backgroundColor, theme.colors.paleTeal);
});
test('disclosure and checkbox keep focus, dimensions and disabled opacity', () => {
  const file = 'src/components/ui.tsx', shared = styles(file);
  const value = stateStyle(file, usesStyle('styles.disclosureButton'), { styles: shared, density: 'standard', compact: false, touch: false, unavailable: false, focused: true, style: undefined });
  opaque(value); assert.equal(value.borderColor, theme.colors.ink); assert.equal(value.borderWidth, 1);
  const checkbox = 'src/components/AppCheckbox.tsx', checkboxStyles = styles(checkbox);
  const enabled = stateStyle(checkbox, usesStyle('styles.row'), { styles: checkboxStyles, compact: false, disabled: false });
  opaque(enabled); assert.equal(enabled.backgroundColor, theme.colors.pressedOverlay);
  assert.equal(stateStyle(checkbox, usesStyle('styles.row'), { styles: checkboxStyles, compact: false, disabled: true }).opacity, .5);
});
test('selected rows and calendar cells deepen without losing selected or warning markers', () => {
  const file = 'src/components/tasks/TaskListRow.tsx', shared = styles(file);
  const row = stateStyle(file, usesStyle('styles.row'), { styles: shared, review: true, selected: true, hovered: false, focused: false, disabled: false });
  opaque(row); assert.equal(row.backgroundColor, theme.colors.selectedNav); assert.equal(row.borderLeftColor, theme.colors.statusWarmLine);
  const calendar = 'src/components/tasks/TasksCalendar.tsx', calendarStyles = styles(calendar);
  const day = stateStyle(calendar, usesStyle('styles.day,'), { styles: calendarStyles, selected: true, focused: true, disabled: false });
  opaque(day); assert.equal(day.backgroundColor, theme.colors.selectedNav); assert.equal(day.borderColor, theme.colors.ink); assert.equal(day.borderWidth, 2);
  assert.equal(stateStyle(calendar, usesStyle('styles.day,'), { styles: calendarStyles, selected: true, focused: true, disabled: true }).opacity, .5);
  const profile = 'src/screens/profileScreen.tsx', profileStyles = styles(profile);
  const child = stateStyle(profile, usesStyle('styles.childOption,'), { styles: profileStyles, item: { id: 'one' }, child: { id: 'one' } });
  opaque(child); assert.equal(child.backgroundColor, theme.colors.selectedPressed); assert.equal(child.borderColor, theme.colors.teal);
});
test('warning and accent actions retain their own palettes while held', () => {
  const tasks = 'src/components/tasks/TasksView.tsx', taskStyles = styles(tasks);
  const warning = stateStyle(tasks, usesStyle('styles.reviewShortcut'), { styles: taskStyles, occupied: false });
  opaque(warning); assert.equal(warning.backgroundColor, theme.colors.warningPressed); assert.equal(warning.borderLeftColor, theme.colors.statusWarmLine);
  const home = 'src/components/HomeQuickActions.tsx', homeStyles = styles(home);
  const camera = stateStyle(home, usesStyle('styles.capture,'), { styles: homeStyles, trigger: { disabled: false } });
  opaque(camera); assert.equal(camera.backgroundColor, theme.colors.accentPressed); assert.equal(camera.borderWidth, undefined);
  const blocked = stateStyle(home, usesStyle('styles.capture,'), { styles: homeStyles, trigger: { disabled: true } });
  assert.equal(blocked.opacity, .5); assert.equal(blocked.backgroundColor, theme.colors.accent);
});
test('chat send feedback is local to its accent surface and disabled state is unchanged', () => {
  const file = 'src/components/agent/AgentComposer.tsx', shared = styles(file);
  const { node, sf } = control(file, (node, sf) => attribute(node, 'accessibilityLabel', sf)?.getText(sf) === '{submitLabel}');
  const child = node.parent.children.find(item => ts.isJsxExpression(item) && item.expression && ts.isArrowFunction(item.expression));
  assert.ok(child, 'send control exposes pressed state to its own circle');
  const render = canPreview => expression(child.expression.getText(sf), { styles: shared, canPreview, View: 'View', AppIcon: 'AppIcon' });
  const enabled = flatten(render(true)({ pressed: true }).props.style); opaque(enabled);
  assert.equal(enabled.backgroundColor, theme.colors.accentPressed); assert.equal(enabled.borderWidth, shared.sendCircle.borderWidth);
  const blocked = flatten(render(false)({ pressed: true }).props.style);
  assert.equal(blocked.opacity, .35); assert.equal(blocked.backgroundColor, theme.colors.accent);
});
test('selected preparation rows no longer switch to a lighter pressed surface', () => {
  const file = 'src/components/preparations/PreparationWorkspace.tsx', shared = styles(file);
  const normal = stateStyle(file, usesStyle('styles.documentRow'), { styles: shared, selected: true }, { pressed: false });
  const pressed = stateStyle(file, usesStyle('styles.documentRow'), { styles: shared, selected: true });
  opaque(pressed); assert.equal(normal.backgroundColor, theme.colors.paleTeal); assert.equal(pressed.backgroundColor, theme.colors.selectedNav);
  assert.equal(pressed.borderWidth, normal.borderWidth); assert.equal(pressed.borderColor, normal.borderColor);
  assert.equal(stateStyle(file, usesStyle('styles.documentRow'), { styles: shared, selected: false }).backgroundColor, theme.colors.quietSurface);
});
