import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Pressable, Text, StyleSheet} from 'react-native-web';

const shell = readFileSync(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
// Evaluate the actual flat style declaration. Theme values do not affect positioning.
const declaration = shell.match(/skipLink:\s*(\{[^}]+\})/u)?.[1];
assert.ok(declaration);
const skipStyle = new Function('colors', 'spacing', 'radius', `return (${declaration});`)({deepTeal: '#16483D'}, {md: 12}, {small: 8});
const customRules = [...layout.matchAll(/\[data-testid="workspace-skip-link"\](?::focus)?\s*\{[^}]+\}/gu)].map(item => item[0]).join('\n');
function render(style) {
  const styles = StyleSheet.create({skip: style});
  const html = renderToStaticMarkup(React.createElement(Pressable, {testID: 'workspace-skip-link', accessibilityRole: 'button', style: styles.skip}, React.createElement(Text, null, '跳到主要內容')));
  const classes = new Set(html.match(/class="([^"]+)"/u)[1].split(' '));
  const css = customRules + '\n' + StyleSheet.getSheet().textContent;
  // Compare these dedicated selectors in actual SSR stylesheet order. This does
  // not claim browser geometry or native focus scheduling; the browser owns those.
  function cascade(focused) {
    const values = {}, priorities = {};
    for (const [,selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const rule = selector.trim();
      const match = rule.startsWith('.') ? classes.has(rule.slice(1)) : rule === '[data-testid="workspace-skip-link"]' || focused && rule === '[data-testid="workspace-skip-link"]:focus';
      if (!match) continue;
      const specificity = rule.endsWith(':focus') ? 2 : 1;
      for (const declaration of body.split(';')) {
        const at = declaration.indexOf(':'); if (at < 0) continue;
        const key = declaration.slice(0,at).trim(), value = declaration.slice(at+1).trim();
        if (specificity >= (priorities[key] ?? 0)) { values[key] = value; priorities[key] = specificity; }
      }
    }
    return values;
  }
  return {html, cascade};
}

test('actual RNWeb skip control stays out of the shell row when RN styles are emitted after custom CSS', () => {
  assert.equal(skipStyle.position, 'absolute'); assert.equal(skipStyle.left, 16); assert.equal(skipStyle.right, 16); assert.equal(skipStyle.zIndex, 1000);
  assert.equal(skipStyle.top, undefined, 'RN must not lock the top coordinate against keyboard focus');
  const actual = render(skipStyle), rest = actual.cascade(false), focused = actual.cascade(true);
  assert.equal(rest.position, 'absolute'); assert.equal(rest.left, '16px'); assert.equal(rest.right, '16px'); assert.equal(rest['z-index'], '1000'); assert.equal(rest.top, '-100px');
  assert.equal(focused.position, 'absolute'); assert.equal(focused.top, '12px');
  assert.match(actual.html, /tabindex="0"/u); assert.match(actual.html, /role="button"/u);
  assert.doesNotMatch(customRules, /position:|z-index:|left:|right:/u);
});

test('the same SSR oracle catches the original relative-position regression', () => {
  const {position, left, right, zIndex, ...oldStyle} = skipStyle;
  const original = render(oldStyle);
  assert.equal(original.cascade(false).position, 'relative');
  assert.notEqual(original.cascade(false).position, 'absolute');
});
