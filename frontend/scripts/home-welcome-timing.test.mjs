import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Harbour Desk deliberately retires the timed/collapsing greeting. Keep testing
// the real component's startup contract, without carrying obsolete motion rules.
function setup(compact = false) {
  let ready = false, consumed = 0;
  const h = harness({
    '../startup/FirstScreenGate': { useFirstScreenReady: () => ready },
    './appearance/HomeBackground': { HomeBackground: 'HomeBackground' },
    '../theme': { chineseFont: 'sans-serif', colors: {}, radius: {}, spacing: {} },
  });
  const { HomeWelcome } = h.load('src/components/HomeWelcome.tsx');
  const props = { compact, introductionPending: true, scopeKey: 'synthetic-child', onIntroductionPresented: () => consumed++ };
  const render = () => h.render(h.jsx(HomeWelcome, props));
  return { h, props, render, ready(value) { ready = value; render(); }, consumed: () => consumed };
}
const text = node => !node ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);

test('stable home orientation keeps one useful heading without precision timestamps or a timed collapse', () => {
  const s = setup(); s.render();
  assert.equal(text(s.h.node('home-welcome')), '今日照顧');
  assert.equal(s.h.hosts().filter(node => node.props.accessibilityRole === 'header').length, 1);
  assert.equal(s.h.hosts().find(node => node.props.accessibilityRole === 'header').props['aria-level'], 1);
  assert.equal(s.h.timers.size, 0); assert.equal(s.h.animations.length, 0);
  s.ready(true); s.h.tick();
  assert.ok(s.h.node('home-welcome'), 'orientation never disappears under the reader');
});

test('startup acknowledgement waits for ready and consumes the session introduction once', () => {
  const s = setup(); s.render(); assert.equal(s.consumed(), 0);
  s.ready(true); assert.equal(s.consumed(), 1);
  s.render(); s.props.scopeKey = 'another-synthetic-child'; s.render(); assert.equal(s.consumed(), 1);
  s.props.introductionPending = false; s.render(); assert.equal(s.consumed(), 1);
});

test('an already consumed introduction does not issue another acknowledgement', () => {
  const s = setup(); s.props.introductionPending = false; s.ready(true); assert.equal(s.consumed(), 0);
});

test('both layouts retain the real startup artwork port and decorative accessibility boundary', () => {
  for (const compact of [false, true]) {
    const s = setup(compact); s.render();
    const background = s.h.hosts().find(node => node.type === 'HomeBackground');
    assert.equal(background.props.useCustomImage, false); assert.equal(background.props.containIllustration, true);
    assert.equal(background.props.webCssFade, true);
    const boundary = s.h.hosts().find(node => node.props['aria-hidden']);
    assert.equal(boundary.props.pointerEvents, 'none');
    assert.equal(boundary.props.importantForAccessibility, 'no-hide-descendants');
    assert.ok(s.h.node('home-welcome'));
    const style = Object.assign({}, ...s.h.node('home-welcome').props.style.filter(Boolean));
    assert.equal(style.minHeight, compact ? 80 : 104);
  }
});
