// A bounded non-browser exercise of the safety adapter, not UI/Bootstrap QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const listeners = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/assets/readonly.js'), 'utf8'), {
  document: { addEventListener(type, handler, capture) {
    assert.equal(capture, true);
    listeners[type] = handler;
  } }
});
function eventFor(kind, key) {
  const state = { prevented: 0, stopped: 0, clicked: 0 };
  const element = { click() { state.clicked++; } };
  return { state, event: { key,
    target: { closest(selector) {
      if (kind === 'route' && selector === 'a[data-preview-route]') return element;
      if (kind === 'toggle' && selector === 'a[data-toggle="dropdown"]') return element;
      return null;
    } },
    preventDefault() { state.prevented++; },
    stopImmediatePropagation() { state.stopped++; }
  } };
}
let checks = 0;
for (const type of ['click', 'keydown']) {
  for (const key of (type === 'click' ? [undefined] : ['Enter', ' '])) {
    const e = eventFor('route', key); listeners[type](e.event);
    assert.deepEqual(e.state, { prevented: 1, stopped: 1, clicked: 0 }); checks++;
  }
}
for (const key of ['Enter', ' ']) {
  const e = eventFor('toggle', key); listeners.keydown(e.event);
  assert.deepEqual(e.state, { prevented: 1, stopped: 0, clicked: 1 }); checks++;
}
for (const [kind, key] of [['toggle', 'Escape'], ['route', 'Tab'], ['other', 'Enter']]) {
  const e = eventFor(kind, key); listeners.keydown(e.event);
  assert.deepEqual(e.state, { prevented: 0, stopped: 0, clicked: 0 }); checks++;
}
console.log(`${checks}/8 bounded safety-adapter branches PASS; not browser or vendor behavior validation.`);
