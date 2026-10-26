import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Pressable, Text} from 'react-native-web';
import {Slot} from '@radix-ui/react-slot';
import ts from 'typescript';

for (const [file, key, href, minHeight, row] of [
  ['src/components/workspace/HomeWorkspace.tsx', 'shortcut', '/summary', 56, true],
  ['src/screens/moreScreen.tsx', 'link', '/tasks', 80, true],
  ['src/components/navigation/MoreNavButton.tsx', 'button', '/more', 64, false],
  ['src/screens/familyScreen.tsx', 'routeLink', '/contact', 48, true],
  ['src/screens/AdminScreen.web.tsx', 'returnLink', '/', 44, false],
]) test(`actual ${key} style survives the installed Expo Slot/RNW merge boundary`, () => {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === key && ts.isObjectLiteralExpression(node.initializer)) expression = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(expression, 'use the actual product style, not a parallel fixture style');
  const style = new Function('colors', 'spacing', 'radius', 'mobileLayout', `return (${expression});`)({line: '#ccd8d3'}, {sm: 8, md: 12}, {small: 8}, {touchTarget: 48, tabMinHeight: 64});
  assert.ok(source.includes(`style={StyleSheet.flatten([styles.${key},`), 'the product must pass a flat object through asChild');
  assert.match(source, /onPressIn=\{\(\) => set/u); assert.match(source, /onPressOut=\{\(\) => set/u);
  function render(childStyle) {
    // Expo BaseExpoRouterLink supplies style even when undefined. Its wrapper
    // flattens that outer prop; actual Radix Slot then merges child props.
    return renderToStaticMarkup(React.createElement(Slot, {href, style: undefined}, React.createElement(Pressable, {accessibilityRole: 'link', style: childStyle}, React.createElement(Text, null, '導航'))));
  }
  const fixed = render(style), original = render(({pressed}) => [style, pressed && {backgroundColor: '#E8F1EC'}]);
  assert.ok(fixed.includes(`href="${href}"`)); assert.match(fixed, /role="link"/u); assert.match(fixed, /tabindex="0"/u);
  assert.ok(fixed.includes(`min-height:${minHeight}px`));
  if (row) { assert.match(fixed, /flex-direction:row/u); assert.match(fixed, /gap:/u); }
  assert.doesNotMatch(original, /min-height:|flex-direction:row|gap:/u, 'the same real dependency boundary reproduces the callback regression');
});
