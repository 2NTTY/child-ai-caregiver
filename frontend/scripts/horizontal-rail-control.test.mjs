import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { horizontalOverflow, horizontalRevealOffset, nextHorizontalItem } from "../src/components/horizontalOverflow.ts";

const require = createRequire(import.meta.url);
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const colors = { muted: "#2D334A", ink: "#272343", quietSurface: "#EDFAF9", paleTeal: "#E3F6F5" };
const filename = new URL("../src/components/HorizontalOverflowRail.tsx", import.meta.url);
const output = ts.transpileModule(readFileSync(filename, "utf8"), {
  fileName: filename.pathname,
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(output.diagnostics?.length ?? 0, 0);

function createRail() {
  const states = [], refs = [], revealed = [], scrolls = [];
  let stateIndex = 0, refIndex = 0;
  const react = {
    forwardRef: render => render, useImperativeHandle() {}, useLayoutEffect() {},
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial }; },
  };
  const native = { Platform: { OS: "android" }, Pressable: "Pressable", View: "View",
    StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 320 }) };
  const dependencies = {
    react, "react/jsx-runtime": require("react/jsx-runtime"), "react-native": native,
    "react-native-reanimated": { default: { View: "AnimatedView" }, cancelAnimation() {}, ReduceMotion: { System: "system" },
      useAnimatedStyle: fn => fn(), useSharedValue: value => ({ value }), withTiming: value => value },
    "../motion/preferences": { useMotionPreferences: () => ({ enabled: false, epoch: 0 }) },
    "../motion/tokens": { motionTokens: {} }, "../theme": { colors },
    "./AppIcon": { AppIcon: "AppIcon" }, "./AppScrollView": { AppScrollView: "AppScrollView" },
    "./horizontalOverflow": { horizontalOverflow, horizontalRevealOffset, nextHorizontalItem },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", output.outputText)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }, module, module.exports);
  const items = [{ key: "first", x: 0, width: 220 }, { key: "second", x: 228, width: 220 }, { key: "third", x: 456, width: 220 }];
  function render() {
    stateIndex = 0; refIndex = 0;
    const tree = module.exports.HorizontalOverflowRail({ items, hintLabel: "查看更多來源",
      onRevealItem: key => revealed.push(key), children: "Source labels" }, null);
    const viewport = tree.props.children[0];
    viewport.props.ref.current = { scrollTo: value => scrolls.push(value) };
    const slot = tree.props.children[1];
    const animated = slot?.props.children;
    return { tree, viewport, slot, animated, button: animated?.props.children };
  }
  const initial = render();
  initial.tree.props.onLayout({ nativeEvent: { layout: { width: 320 } } });
  initial.viewport.props.onLayout({ nativeEvent: { layout: { width: 272 } } });
  initial.viewport.props.onContentSizeChange(676, 48);
  return { render, revealed, scrolls };
}

test("overflow arrows are transparent at rest and retain a separate 48px touch slot", () => {
  const { tree, viewport, slot, animated, button } = createRail().render();
  assert.equal(flatten(tree.props.style).flexDirection, "row");
  assert.equal(flatten(slot.props.style).width, 48);
  assert.equal(flatten(slot.props.style).flexShrink, 0);
  assert.equal(flatten(slot.props.style).position, undefined);
  assert.equal(viewport.props.children, "Source labels");
  assert.equal(viewport.props.showsHorizontalScrollIndicator, false);
  for (const control of [animated, button]) {
    const style = flatten(control.props.style);
    assert.equal(style.width, 48); assert.equal(style.minHeight, 48);
    assert.equal(style.backgroundColor, undefined); assert.equal(style.borderWidth, undefined);
  }
  const glyph = button.props.children({ pressed: false });
  assert.equal(flatten(glyph.props.style).backgroundColor, "transparent");
  assert.equal(flatten(glyph.props.style).borderColor, "transparent");
  assert.equal(glyph.props.children.props.name, "chevron-right");
  assert.equal(glyph.props.children.props.color, colors.muted);
  assert.equal(glyph.props.children.props.size, 20);
});

test("hover, press and focus feedback stays inside the small glyph without changing the touch target", () => {
  const rail = createRail();
  rail.render().button.props.onHoverIn();
  assert.equal(flatten(rail.render().button.props.children({ pressed: false }).props.style).backgroundColor, colors.quietSurface);
  assert.equal(flatten(rail.render().button.props.children({ pressed: true }).props.style).backgroundColor, colors.paleTeal);
  rail.render().button.props.onHoverOut();
  rail.render().button.props.onFocus();
  const focused = flatten(rail.render().button.props.children({ pressed: false }).props.style);
  assert.equal(focused.width, 32); assert.equal(focused.height, 32);
  assert.equal(focused.borderColor, colors.ink); assert.equal(focused.backgroundColor, "transparent");
  rail.render().button.props.onBlur();
  assert.equal(flatten(rail.render().button.props.children({ pressed: false }).props.style).borderColor, "transparent");
});

test("source reveal, keyboard entry, reader label and end-of-rail disabling are preserved", () => {
  const rail = createRail();
  const active = rail.render();
  assert.equal(active.button.props.accessibilityRole, "button");
  assert.equal(active.button.props.accessibilityLabel, "查看更多來源");
  assert.equal(active.button.props.tabIndex, 0);
  assert.equal(active.button.props.disabled, false);
  active.button.props.onPress();
  assert.deepEqual(rail.revealed, ["second"]);
  assert.deepEqual(rail.scrolls, [{ x: 176, animated: false }]);
  active.viewport.props.onScroll({ nativeEvent: { contentOffset: { x: 404 } } });
  const end = rail.render();
  assert.equal(end.button.props.tabIndex, -1);
  assert.equal(end.button.props.disabled, true);
  assert.equal(end.button.props["aria-disabled"], true);
  assert.equal(end.button.props.accessibilityState.disabled, true);
  assert.equal(end.animated.props.pointerEvents, "none");
  assert.equal(end.animated.props["aria-hidden"], true);
  assert.equal(flatten(end.slot.props.style).width, 48);
});
